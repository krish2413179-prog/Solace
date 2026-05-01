// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IAgentRegistry {
    function isAvailable(address wallet) external view returns (bool);
    function isJailed(address wallet) external view returns (bool);
    function getScore(address wallet) external view returns (uint256);
    function slashAgent(address wallet) external;
    function recordDelivery(address wallet, uint256 payout) external;
    function recordFailure(address wallet) external;
    function lockStake(address wallet, uint256 amount) external;
    function unlockStake(address wallet, uint256 amount) external;
}

contract Solace {

    uint256 public constant DISPUTE_WINDOW_BLOCKS = 48;
    uint256 public constant REPLACEMENT_WINDOW    = 30 minutes;
    uint256 public constant CASCADE_BUFFER        = 4 hours;
    uint256 public constant MIN_VIABLE_WINDOW     = 2 hours;
    uint256 public constant INSURANCE_BPS         = 300;
    uint256 public constant MAX_AGENTS            = 15;
    uint256 public constant MAX_DEPTH             = 8;
    uint256 public constant VALIDATOR_COUNT       = 3;

    enum PipelineStatus { NonExistent, Pending, Active, FailedPending, Settled, RolledBack }
    enum StepStatus     { Pending, Runnable, Committed, Delivered, Accepted, Disputed, Failed }

    struct Step {
        address    agent;
        uint256    payout;
        bytes32    commitHash;
        bytes32    childPipelineId;
        StepStatus status;
        uint256    disputeBlock;
        uint256    replacementDeadline;
    }

    struct PipelineMeta {
        address        orchestrator;
        bytes32        parentPipelineId;
        uint256        parentStepIndex;
        uint256        deadline;
        uint256        bounty;
        uint256        deliveredCount;
        uint256        acceptedCount;
        uint256        failedCount;
        string         pipelineType;
        PipelineStatus status;
        uint8          depth;
        uint256        minScore;
    }

    struct DisputePanel {
        address[3] validators;
        uint8      count;
        uint8      votesFor;
        uint8      votesAgainst;
    }

    IAgentRegistry public registry;
    address        public verifier;
    address        public insurancePool;
    address        public owner;
    uint256        public slashCollected;

    mapping(bytes32 => PipelineMeta)                         private metas;
    mapping(bytes32 => Step[])                               private steps;
    mapping(bytes32 => uint256[][])                          private stepDeps;
    mapping(bytes32 => mapping(address => uint256))          private agentIdx;
    mapping(bytes32 => address[])                            private ancestorAgents;
    mapping(bytes32 => mapping(uint256 => DisputePanel))     private panels;
    mapping(bytes32 => mapping(uint256 => mapping(address => bool))) private voted;
    mapping(address => bytes32[])                            public  agentPipelines;
    mapping(address => bytes32[])                            public  orchPipelines;

    event PipelineCreated(bytes32 indexed id, address indexed orch, bytes32 parentId, uint8 depth, uint256 bounty, uint256 deadline);
    event CommitmentsLocked(bytes32 indexed id);
    event StepUnlocked(bytes32 indexed id, uint256 stepIndex);
    event WorkSubmitted(bytes32 indexed id, uint256 stepIndex, address agent);
    event StepVerified(bytes32 indexed id, uint256 stepIndex, bool passed);
    event StepAccepted(bytes32 indexed id, uint256 stepIndex);
    event StepDisputed(bytes32 indexed id, uint256 stepIndex);
    event ValidatorJoined(bytes32 indexed id, uint256 stepIndex, address validator);
    event DisputeVoteCast(bytes32 indexed id, uint256 stepIndex, address validator, bool votedFor);
    event DisputeResolved(bytes32 indexed id, uint256 stepIndex, bool agentWon);
    event StepFailed(bytes32 indexed id, uint256 stepIndex, bytes32 parentId, uint256 parentStepIndex);
    event ReplacementWindowOpen(bytes32 indexed id, uint256 stepIndex, uint256 replacementDeadline);
    event AgentReplaced(bytes32 indexed id, uint256 stepIndex, address oldAgent, address newAgent);
    event ChildPipelineLinked(bytes32 indexed parentId, uint256 stepIndex, bytes32 childId);
    event ChildSettledNotified(bytes32 indexed parentId, uint256 stepIndex);
    event PipelineSettled(bytes32 indexed id, uint256 totalPaid);
    event PipelineRolledBack(bytes32 indexed id, bytes32 parentId, uint256 parentStepIndex, uint256 refund);

    error DoesNotExist();
    error AlreadyExists();
    error BadStatus();
    error NotOrch();
    error NotAgent();
    error BadLength();
    error NoAgents();
    error TooManyAgents();
    error BadValue();
    error TooSoon();
    error TooLate();
    error NotLate();
    error AlreadyDone();
    error BadHash();
    error NotDelivered();
    error NotDisputed();
    error ZeroPay();
    error Duplicate();
    error TransferFail();
    error ScoreTooLow();
    error CyclicAgent();
    error BadDep();
    error DepsNotMet();
    error ChildNotSettled();
    error BadDepth();
    error BadCascadeBuffer();
    error NotVerifier();
    error NotValidator();
    error AlreadyVoted();
    error PanelFull();
    error NotFailedPending();
    error ReplacementExpired();
    error ReplacementActive();
    error NotLinked();
    error NotOwner();

    modifier live(bytes32 id) {
        if (metas[id].status == PipelineStatus.NonExistent) revert DoesNotExist();
        _;
    }

    modifier onlyOrch(bytes32 id) {
        if (metas[id].orchestrator != msg.sender) revert NotOrch();
        _;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address _registry, address _verifier, address _insurancePool) {
        registry     = IAgentRegistry(_registry);
        verifier     = _verifier;
        insurancePool = _insurancePool;
        owner        = msg.sender;
    }

    function setVerifier(address _verifier) external onlyOwner {
        verifier = _verifier;
    }

    function _initializeAncestors(bytes32 id, bytes32 parentPipelineId, uint256 deadline) internal returns (uint8) {
        if (parentPipelineId == bytes32(0)) return 0;

        if (metas[parentPipelineId].status == PipelineStatus.NonExistent) revert DoesNotExist();
        if (metas[parentPipelineId].depth >= MAX_DEPTH) revert BadDepth();
        if (deadline + CASCADE_BUFFER > metas[parentPipelineId].deadline) revert BadCascadeBuffer();

        uint256 len = ancestorAgents[parentPipelineId].length;
        for (uint256 i = 0; i < len; i++) {
            ancestorAgents[id].push(ancestorAgents[parentPipelineId][i]);
        }
        
        len = steps[parentPipelineId].length;
        for (uint256 i = 0; i < len; i++) {
            ancestorAgents[id].push(steps[parentPipelineId][i].agent);
        }

        return metas[parentPipelineId].depth + 1;
    }

    function _validateAndAddAgents(
        bytes32 id,
        address[] calldata agents,
        uint256[] calldata payouts,
        uint256[][] calldata dependsOn,
        uint256 minScore
    ) internal returns (uint256) {
        uint256 total = 0;
        address[] storage anc = ancestorAgents[id];

        for (uint256 i = 0; i < agents.length; i++) {
            if (payouts[i] == 0) revert ZeroPay();
            if (agentIdx[id][agents[i]] != 0) revert Duplicate();
            if (!registry.isAvailable(agents[i])) revert NotAgent();
            if (registry.getScore(agents[i]) < minScore) revert ScoreTooLow();

            for (uint256 j = 0; j < anc.length; j++) {
                if (anc[j] == agents[i]) revert CyclicAgent();
            }

            for (uint256 j = 0; j < dependsOn[i].length; j++) {
                if (dependsOn[i][j] >= agents.length) revert BadDep();
            }

            total += payouts[i];

            steps[id].push(Step({
                agent: agents[i],
                payout: payouts[i],
                commitHash: bytes32(0),
                childPipelineId: bytes32(0),
                status: StepStatus.Pending,
                disputeBlock: 0,
                replacementDeadline: 0
            }));

            stepDeps[id].push(dependsOn[i]);
            agentIdx[id][agents[i]] = i + 1;
            agentPipelines[agents[i]].push(id);
        }

        return total;
    }

    function createPipeline(
        bytes32     id,
        uint256     deadline,
        string calldata pType,
        uint256     minScore,
        bytes32     parentPipelineId,
        uint256     parentStepIndex,
        address[] calldata agents,
        uint256[] calldata payouts,
        uint256[][] calldata dependsOn
    ) external payable {
        if (metas[id].status != PipelineStatus.NonExistent)  revert AlreadyExists();
        if (agents.length == 0)                               revert NoAgents();
        if (agents.length > MAX_AGENTS)                       revert TooManyAgents();
        if (agents.length != payouts.length)                  revert BadLength();
        if (agents.length != dependsOn.length)                revert BadLength();

        uint8 depth = _initializeAncestors(id, parentPipelineId, deadline);
        uint256 total = _validateAndAddAgents(id, agents, payouts, dependsOn, minScore);

        uint256 insurance = (total * INSURANCE_BPS) / 10000;
        if (msg.value != total + insurance) revert BadValue();

        (bool ok,) = insurancePool.call{value: insurance}("");
        if (!ok) revert TransferFail();

        metas[id] = PipelineMeta({
            orchestrator:      msg.sender,
            parentPipelineId:  parentPipelineId,
            parentStepIndex:   parentStepIndex,
            deadline:          deadline,
            bounty:            total,
            deliveredCount:    0,
            acceptedCount:     0,
            failedCount:       0,
            pipelineType:      pType,
            status:            PipelineStatus.Pending,
            depth:             depth,
            minScore:          minScore
        });

        orchPipelines[msg.sender].push(id);

        if (parentPipelineId != bytes32(0)) {
            emit ChildPipelineLinked(parentPipelineId, parentStepIndex, id);
        }

        emit PipelineCreated(id, msg.sender, parentPipelineId, depth, total, deadline);
    }

    function linkChildPipeline(bytes32 parentId, uint256 stepIndex, bytes32 childId)
        external live(parentId)
    {
        Step storage s = steps[parentId][stepIndex];
        if (s.agent != msg.sender)           revert NotAgent();
        if (s.childPipelineId != bytes32(0)) revert AlreadyDone();

        PipelineMeta storage child = metas[childId];
        if (child.status == PipelineStatus.NonExistent) revert DoesNotExist();
        if (child.parentPipelineId != parentId)         revert NotLinked();
        if (child.parentStepIndex != stepIndex)         revert NotLinked();

        s.childPipelineId = childId;
        registry.lockStake(msg.sender, child.bounty);
        emit ChildPipelineLinked(parentId, stepIndex, childId);
    }

    function lockCommitments(bytes32 id, bytes32[] calldata hashes)
        external live(id) onlyOrch(id)
    {
        PipelineMeta storage m = metas[id];
        if (m.status != PipelineStatus.Pending)     revert BadStatus();
        if (hashes.length != steps[id].length)      revert BadLength();
        if (block.timestamp >= m.deadline)           revert TooLate();

        Step[] storage ss = steps[id];
        for (uint256 i = 0; i < ss.length; i++) {
            ss[i].commitHash = hashes[i];
            if (stepDeps[id][i].length == 0) {
                ss[i].status = StepStatus.Runnable;
                emit StepUnlocked(id, i);
            } else {
                ss[i].status = StepStatus.Committed;
            }
        }

        m.status = PipelineStatus.Active;
        emit CommitmentsLocked(id);
    }

    function submitWork(bytes32 id, uint256 stepIndex, bytes32 hash)
        external live(id)
    {
        PipelineMeta storage m = metas[id];
        if (m.status != PipelineStatus.Active)       revert BadStatus();
        if (block.timestamp > m.deadline)            revert TooLate();

        Step storage s = steps[id][stepIndex];
        if (s.agent != msg.sender)                   revert NotAgent();
        if (s.status != StepStatus.Runnable)         revert DepsNotMet();
        if (hash != s.commitHash)                    revert BadHash();

        if (s.childPipelineId != bytes32(0)) {
            if (metas[s.childPipelineId].status != PipelineStatus.Settled) revert ChildNotSettled();
        }

        emit WorkSubmitted(id, stepIndex, msg.sender);
        
        _acceptStep(id, stepIndex);
    }

    function reportVerification(bytes32 id, uint256 stepIndex, bool passed)
        external live(id)
    {
        if (msg.sender != verifier) revert NotVerifier();

        Step storage s = steps[id][stepIndex];
        if (s.status != StepStatus.Delivered) revert NotDelivered();

        emit StepVerified(id, stepIndex, passed);

        if (passed) {
            _acceptStep(id, stepIndex);
        } else {
            _openDispute(id, stepIndex);
        }
    }

    function autoAccept(bytes32 id, uint256 stepIndex) external live(id) {
        Step storage s = steps[id][stepIndex];
        if (s.status != StepStatus.Delivered)         revert NotDelivered();
        if (block.number <= s.disputeBlock)           revert TooSoon();

        _acceptStep(id, stepIndex);
    }

    function joinValidatorPanel(bytes32 id, uint256 stepIndex)
        external live(id)
    {
        Step storage s = steps[id][stepIndex];
        if (s.status != StepStatus.Disputed)          revert NotDisputed();
        if (agentIdx[id][msg.sender] != 0)            revert NotAgent();
        if (!registry.isAvailable(msg.sender))        revert NotAgent();

        DisputePanel storage panel = panels[id][stepIndex];
        if (panel.count >= VALIDATOR_COUNT)           revert PanelFull();

        for (uint256 i = 0; i < panel.count; i++) {
            if (panel.validators[i] == msg.sender)    revert Duplicate();
        }

        panel.validators[panel.count] = msg.sender;
        panel.count += 1;
        emit ValidatorJoined(id, stepIndex, msg.sender);
    }

    function voteOnDispute(bytes32 id, uint256 stepIndex, bool agentWon)
        external live(id)
    {
        Step storage s = steps[id][stepIndex];
        if (s.status != StepStatus.Disputed)         revert NotDisputed();
        if (voted[id][stepIndex][msg.sender])        revert AlreadyVoted();

        DisputePanel storage panel = panels[id][stepIndex];
        bool isValidator = false;
        for (uint256 i = 0; i < panel.count; i++) {
            if (panel.validators[i] == msg.sender) { isValidator = true; break; }
        }
        if (!isValidator) revert NotValidator();

        voted[id][stepIndex][msg.sender] = true;
        if (agentWon) panel.votesFor++;
        else          panel.votesAgainst++;

        emit DisputeVoteCast(id, stepIndex, msg.sender, agentWon);

        uint8 majority = uint8((VALIDATOR_COUNT / 2) + 1);
        if (panel.votesFor >= majority) {
            emit DisputeResolved(id, stepIndex, true);
            _acceptStep(id, stepIndex);
        } else if (panel.votesAgainst >= majority) {
            emit DisputeResolved(id, stepIndex, false);
            _failStep(id, stepIndex, true);
        }
    }

    function openReplacementWindow(bytes32 id, uint256 stepIndex)
        external live(id)
    {
        PipelineMeta storage m = metas[id];
        if (m.status != PipelineStatus.Active && m.status != PipelineStatus.FailedPending) revert BadStatus();

        Step storage s = steps[id][stepIndex];
        if (s.status != StepStatus.Failed)           revert BadStatus();
        if (s.childPipelineId == bytes32(0)) {
            if (s.replacementDeadline != 0)          revert ReplacementActive();
        }

        uint256 timeLeft = m.deadline > block.timestamp ? m.deadline - block.timestamp : 0;
        if (timeLeft < MIN_VIABLE_WINDOW)            revert TooLate();

        s.replacementDeadline = block.timestamp + REPLACEMENT_WINDOW;
        m.status = PipelineStatus.FailedPending;
        emit ReplacementWindowOpen(id, stepIndex, s.replacementDeadline);
    }

    function replaceAgent(bytes32 id, uint256 stepIndex, address newAgent, bytes32 newCommitHash)
        external live(id) onlyOrch(id)
    {
        PipelineMeta storage m = metas[id];
        if (m.status != PipelineStatus.FailedPending) revert NotFailedPending();

        Step storage s = steps[id][stepIndex];
        if (s.status != StepStatus.Failed)            revert BadStatus();
        if (block.timestamp > s.replacementDeadline)  revert ReplacementExpired();

        if (!registry.isAvailable(newAgent))          revert NotAgent();
        if (registry.getScore(newAgent) < m.minScore) revert ScoreTooLow();
        if (agentIdx[id][newAgent] != 0)              revert Duplicate();

        address[] storage anc = ancestorAgents[id];
        for (uint256 i = 0; i < anc.length; i++) {
            if (anc[i] == newAgent)                   revert CyclicAgent();
        }

        address old = s.agent;
        agentIdx[id][old]     = 0;
        agentIdx[id][newAgent] = stepIndex + 1;
        s.agent               = newAgent;
        s.commitHash          = newCommitHash;
        s.childPipelineId     = bytes32(0);
        s.status              = StepStatus.Runnable;
        s.disputeBlock        = 0;
        s.replacementDeadline = 0;

        m.status       = PipelineStatus.Active;
        m.failedCount -= 1;

        agentPipelines[newAgent].push(id);

        emit AgentReplaced(id, stepIndex, old, newAgent);
    }

    function notifyChildSettled(bytes32 parentId, uint256 stepIndex, bytes32 childId)
        external live(parentId)
    {
        PipelineMeta storage child = metas[childId];
        if (child.status != PipelineStatus.Settled)        revert BadStatus();
        if (child.parentPipelineId != parentId)            revert NotLinked();
        if (child.parentStepIndex != stepIndex)            revert NotLinked();

        Step storage s = steps[parentId][stepIndex];
        if (s.childPipelineId != childId)                  revert NotLinked();
        if (s.status != StepStatus.Committed && s.status != StepStatus.Runnable) revert BadStatus();

        registry.unlockStake(s.agent, child.bounty);
        s.status = StepStatus.Runnable;
        emit ChildSettledNotified(parentId, stepIndex);
    }

    function propagateFailure(bytes32 parentId, uint256 stepIndex, bytes32 childId)
        external live(parentId)
    {
        PipelineMeta storage child = metas[childId];
        if (child.status != PipelineStatus.RolledBack) revert BadStatus();
        if (child.parentPipelineId != parentId)        revert NotLinked();
        if (child.parentStepIndex != stepIndex)        revert NotLinked();

        Step storage s = steps[parentId][stepIndex];
        if (s.childPipelineId != childId)              revert NotLinked();

        registry.unlockStake(s.agent, child.bounty);
        _failStep(parentId, stepIndex, false);
    }

    function rollback(bytes32 id) external live(id) {
        PipelineMeta storage m = metas[id];
        if (m.status == PipelineStatus.Settled || m.status == PipelineStatus.RolledBack) revert BadStatus();
        if (block.timestamp <= m.deadline) revert NotLate();

        _rollback(id);
    }

    function forceRollbackOnFailure(bytes32 id) external live(id) {
        PipelineMeta storage m = metas[id];
        if (m.status != PipelineStatus.Active && m.status != PipelineStatus.FailedPending) revert BadStatus();

        bool hasFailure = false;
        Step[] storage ss = steps[id];
        for (uint256 i = 0; i < ss.length; i++) {
            if (ss[i].status == StepStatus.Failed) { hasFailure = true; break; }
        }
        if (!hasFailure) revert BadStatus();

        uint256 timeLeft = m.deadline > block.timestamp ? m.deadline - block.timestamp : 0;
        if (timeLeft >= MIN_VIABLE_WINDOW) revert TooSoon();

        _rollback(id);
    }

    function _acceptStep(bytes32 id, uint256 stepIndex) internal {
        PipelineMeta storage m = metas[id];
        Step storage s = steps[id][stepIndex];

        s.status = StepStatus.Accepted;
        m.acceptedCount += 1;

        registry.recordDelivery(s.agent, s.payout);
        emit StepAccepted(id, stepIndex);

        _unlockDependents(id, stepIndex);

        if (m.acceptedCount == steps[id].length) {
            _settle(id);
        }
    }

    function _openDispute(bytes32 id, uint256 stepIndex) internal {
        steps[id][stepIndex].status = StepStatus.Disputed;
        emit StepDisputed(id, stepIndex);
    }

    function _failStep(bytes32 id, uint256 stepIndex, bool slash) internal {
        PipelineMeta storage m = metas[id];
        Step storage s = steps[id][stepIndex];

        s.status = StepStatus.Failed;
        m.failedCount += 1;

        registry.recordFailure(s.agent);
        if (slash) {
            registry.slashAgent(s.agent);
        }

        emit StepFailed(id, stepIndex, m.parentPipelineId, m.parentStepIndex);
    }

    function _unlockDependents(bytes32 id, uint256 acceptedIndex) internal {
        Step[] storage ss = steps[id];
        for (uint256 i = 0; i < ss.length; i++) {
            if (ss[i].status != StepStatus.Committed) continue;
            uint256[] storage deps = stepDeps[id][i];
            bool allMet = true;
            for (uint256 j = 0; j < deps.length; j++) {
                if (steps[id][deps[j]].status != StepStatus.Accepted) {
                    allMet = false;
                    break;
                }
            }
            if (allMet) {
                ss[i].status = StepStatus.Runnable;
                emit StepUnlocked(id, i);
            }
        }
    }

    function _settle(bytes32 id) internal {
        PipelineMeta storage m = metas[id];
        m.status = PipelineStatus.Settled;
        uint256 paid = 0;
        Step[] storage ss = steps[id];
        for (uint256 i = 0; i < ss.length; i++) {
            uint256 v = ss[i].payout;
            paid += v;
            (bool ok,) = ss[i].agent.call{value: v}("");
            if (!ok) revert TransferFail();
        }
        emit PipelineSettled(id, paid);
    }

    function _rollback(bytes32 id) internal {
        PipelineMeta storage m = metas[id];
        m.status = PipelineStatus.RolledBack;

        Step[] storage ss = steps[id];
        for (uint256 i = 0; i < ss.length; i++) {
            if (ss[i].status != StepStatus.Accepted) {
                registry.recordFailure(ss[i].agent);
                registry.slashAgent(ss[i].agent);
            }
        }

        uint256 refund = m.bounty;
        m.bounty = 0;
        (bool ok,) = m.orchestrator.call{value: refund}("");
        if (!ok) revert TransferFail();

        emit PipelineRolledBack(id, m.parentPipelineId, m.parentStepIndex, refund);
    }

    function getPipelineStatus(bytes32 id) external view returns (PipelineStatus) {
        return metas[id].status;
    }

    function getPipelineCore(bytes32 id) external view live(id) returns (
        address  orch,
        bytes32  parentId,
        uint256  deadline,
        uint256  bounty,
        uint256  delivered,
        uint256  accepted,
        uint256  total,
        uint8    depth,
        PipelineStatus status
    ) {
        PipelineMeta storage m = metas[id];
        return (
            m.orchestrator,
            m.parentPipelineId,
            m.deadline,
            m.bounty,
            m.deliveredCount,
            m.acceptedCount,
            steps[id].length,
            m.depth,
            m.status
        );
    }

    function getStep(bytes32 id, uint256 i) external view live(id) returns (
        address    agent,
        uint256    payout,
        bytes32    commitHash,
        bytes32    childPipelineId,
        StepStatus status,
        uint256    disputeBlock,
        uint256    replacementDeadline
    ) {
        Step storage s = steps[id][i];
        return (s.agent, s.payout, s.commitHash, s.childPipelineId, s.status, s.disputeBlock, s.replacementDeadline);
    }

    function getStepDeps(bytes32 id, uint256 i) external view live(id) returns (uint256[] memory) {
        return stepDeps[id][i];
    }

    function getStepCount(bytes32 id) external view returns (uint256) {
        return steps[id].length;
    }

    function getAncestorAgents(bytes32 id) external view returns (address[] memory) {
        return ancestorAgents[id];
    }

    function getAgentPipelines(address w) external view returns (bytes32[] memory) {
        return agentPipelines[w];
    }

    function getOrchPipelines(address w) external view returns (bytes32[] memory) {
        return orchPipelines[w];
    }

    receive() external payable {
        slashCollected += msg.value;
    }
}
