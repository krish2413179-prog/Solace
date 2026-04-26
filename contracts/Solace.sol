// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IAgentRegistry {
    function isRegistered(address wallet) external view returns (bool);
    function isAvailable(address wallet)  external view returns (bool);
    function isJailed(address wallet)     external view returns (bool);
    function slashAgent(address wallet)   external;
    function recordDelivery(address wallet, uint256 payout) external;
    function recordFailure(address wallet) external;
}

contract Solace {

    uint256 public constant MIN_PIPELINE_DURATION = 5 minutes;
    uint256 public constant DISPUTE_WINDOW_BLOCKS = 48;

    enum Status   { NonExistent, Pending, Active, Disputed, Settled, RolledBack }
    enum Delivery { Pending, Delivered, Accepted, Rejected }

    struct Agent {
        address  wallet;
        uint256  payout;
        bytes32  commitHash;
        bool     delivered;
        Delivery deliveryStatus;
        uint256  disputeBlock;
    }

    struct Meta {
        address orchestrator;
        uint256 deadline;
        uint256 bounty;
        uint256 deliveredCount;
        uint256 acceptedCount;
        string  pipelineType;
        Status  status;
    }

    IAgentRegistry public registry;

    mapping(bytes32 => Meta)                            private metas;
    mapping(bytes32 => Agent[])                         private slots;
    mapping(bytes32 => mapping(address => uint256))     private idx;
    mapping(address => bytes32[])                       public  agentPipelines;
    mapping(address => bytes32[])                       public  orchPipelines;

    event PipelineCreated(bytes32 indexed id, address indexed orch, string pType, uint256 bounty, uint256 deadline);
    event CommitmentsLocked(bytes32 indexed id);
    event WorkSubmitted(bytes32 indexed id, address indexed agent, uint256 delivered, uint256 total);
    event DeliveryAccepted(bytes32 indexed id, address indexed agent);
    event DeliveryDisputed(bytes32 indexed id, address indexed agent);
    event DisputeResolved(bytes32 indexed id, address indexed agent, bool agentWon);
    event PipelineSettled(bytes32 indexed id, uint256 totalPaid);
    event PipelineRolledBack(bytes32 indexed id, address indexed orch, uint256 refund);

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
    error NoDisputeWindow();
    error ZeroPay();
    error Duplicate();
    error TransferFail();

    modifier live(bytes32 id) {
        if (metas[id].status == Status.NonExistent) revert DoesNotExist();
        _;
    }

    modifier onlyOrch(bytes32 id) {
        if (metas[id].orchestrator != msg.sender) revert NotOrch();
        _;
    }

    constructor(address _registry) {
        registry = IAgentRegistry(_registry);
    }

    function createPipeline(
        bytes32            id,
        uint256            deadline,
        string    calldata pType,
        address[] calldata wallets,
        uint256[] calldata payouts
    ) external payable {
        if (metas[id].status != Status.NonExistent)        revert AlreadyExists();
        if (wallets.length == 0)                           revert NoAgents();
        if (wallets.length > 10)                           revert TooManyAgents();
        if (wallets.length != payouts.length)              revert BadLength();
        if (block.timestamp + MIN_PIPELINE_DURATION > deadline) revert TooSoon();

        uint256 total = 0;
        for (uint256 i = 0; i < wallets.length; i++) {
            if (payouts[i] == 0)                revert ZeroPay();
            if (idx[id][wallets[i]] != 0)       revert Duplicate();
            if (!registry.isAvailable(wallets[i])) revert NotAgent();

            total += payouts[i];
            slots[id].push(Agent({
                wallet:         wallets[i],
                payout:         payouts[i],
                commitHash:     bytes32(0),
                delivered:      false,
                deliveryStatus: Delivery.Pending,
                disputeBlock:   0
            }));
            idx[id][wallets[i]] = i + 1;
            agentPipelines[wallets[i]].push(id);
        }

        if (msg.value != total) revert BadValue();

        metas[id] = Meta({
            orchestrator:   msg.sender,
            deadline:       deadline,
            bounty:         msg.value,
            deliveredCount: 0,
            acceptedCount:  0,
            pipelineType:   pType,
            status:         Status.Pending
        });

        orchPipelines[msg.sender].push(id);
        emit PipelineCreated(id, msg.sender, pType, msg.value, deadline);
    }

    function lockCommitments(bytes32 id, bytes32[] calldata hashes)
        external live(id) onlyOrch(id)
    {
        Meta storage m = metas[id];
        if (m.status != Status.Pending)       revert BadStatus();
        if (hashes.length != slots[id].length) revert BadLength();
        if (block.timestamp >= m.deadline)     revert TooLate();

        for (uint256 i = 0; i < hashes.length; i++) {
            slots[id][i].commitHash = hashes[i];
        }
        m.status = Status.Active;
        emit CommitmentsLocked(id);
    }

    function submitWork(bytes32 id, bytes32 hash) external live(id) {
        Meta storage m = metas[id];
        if (m.status != Status.Active)   revert BadStatus();
        if (block.timestamp > m.deadline) revert TooLate();

        uint256 i = idx[id][msg.sender];
        if (i == 0) revert NotAgent();

        Agent storage a = slots[id][i - 1];
        if (a.delivered)          revert AlreadyDone();
        if (hash != a.commitHash) revert BadHash();

        a.delivered      = true;
        a.deliveryStatus = Delivery.Delivered;
        a.disputeBlock   = block.number + DISPUTE_WINDOW_BLOCKS;
        m.deliveredCount += 1;

        emit WorkSubmitted(id, msg.sender, m.deliveredCount, slots[id].length);

        if (m.deliveredCount == slots[id].length) {
            _settle(id);
        }
    }

    function acceptDelivery(bytes32 id, uint256 i) external live(id) onlyOrch(id) {
        Meta  storage m = metas[id];
        Agent storage a = slots[id][i];

        if (m.status != Status.Active && m.status != Status.Disputed) revert BadStatus();
        if (!a.delivered)                              revert NotDelivered();
        if (a.deliveryStatus != Delivery.Delivered)    revert AlreadyDone();

        a.deliveryStatus = Delivery.Accepted;
        m.acceptedCount += 1;

        emit DeliveryAccepted(id, a.wallet);
        if (m.acceptedCount == slots[id].length) _settle(id);
    }

    function disputeDelivery(bytes32 id, uint256 i) external live(id) onlyOrch(id) {
        Meta  storage m = metas[id];
        Agent storage a = slots[id][i];

        if (m.status != Status.Active)              revert BadStatus();
        if (!a.delivered)                           revert NotDelivered();
        if (block.number > a.disputeBlock)          revert NoDisputeWindow();

        a.deliveryStatus = Delivery.Rejected;
        m.status         = Status.Disputed;
        emit DeliveryDisputed(id, a.wallet);
    }

    function resolveDispute(bytes32 id, uint256 i, bool agentWon) external live(id) {
        Meta  storage m = metas[id];
        Agent storage a = slots[id][i];

        if (m.status != Status.Disputed) revert NotDisputed();

        if (agentWon) {
            a.deliveryStatus = Delivery.Accepted;
            m.acceptedCount += 1;
            m.status         = Status.Active;
            if (m.acceptedCount == slots[id].length) _settle(id);
        } else {
            registry.slashAgent(a.wallet);
            registry.recordFailure(a.wallet);
            uint256 refund = m.bounty;
            m.bounty       = 0;
            m.status       = Status.RolledBack;
            (bool ok,) = m.orchestrator.call{value: refund}("");
            if (!ok) revert TransferFail();
            emit PipelineRolledBack(id, m.orchestrator, refund);
        }
        emit DisputeResolved(id, a.wallet, agentWon);
    }

    function rollback(bytes32 id) external live(id) {
        Meta storage m = metas[id];
        if (m.status == Status.Settled || m.status == Status.RolledBack) revert BadStatus();
        if (block.timestamp <= m.deadline) revert NotLate();

        for (uint256 i = 0; i < slots[id].length; i++) {
            if (!slots[id][i].delivered) {
                registry.slashAgent(slots[id][i].wallet);
                registry.recordFailure(slots[id][i].wallet);
            }
        }

        uint256 refund = m.bounty;
        m.bounty       = 0;
        m.status       = Status.RolledBack;
        (bool ok,) = m.orchestrator.call{value: refund}("");
        if (!ok) revert TransferFail();
        emit PipelineRolledBack(id, m.orchestrator, refund);
    }

    function getPipelineStatus(bytes32 id) external view returns (Status) {
        return metas[id].status;
    }

    function getPipelineCore(bytes32 id)
        external view live(id)
        returns (
            address orch,
            uint256 deadline,
            uint256 bounty,
            uint256 delivered,
            uint256 total,
            Status  status
        )
    {
        Meta storage m = metas[id];
        return (m.orchestrator, m.deadline, m.bounty, m.deliveredCount, slots[id].length, m.status);
    }

    function getPipelineMeta(bytes32 id)
        external view live(id)
        returns (
            uint256       accepted,
            string memory pType
        )
    {
        Meta storage m = metas[id];
        return (m.acceptedCount, m.pipelineType);
    }

    function getAgentSlot(bytes32 id, uint256 i)
        external view live(id)
        returns (address wallet, uint256 payout, bytes32 commitHash, bool delivered, Delivery deliveryStatus, uint256 disputeBlock)
    {
        Agent storage a = slots[id][i];
        return (a.wallet, a.payout, a.commitHash, a.delivered, a.deliveryStatus, a.disputeBlock);
    }

    function getAgentPipelines(address w) external view returns (bytes32[] memory) { return agentPipelines[w]; }
    function getOrchPipelines(address w)  external view returns (bytes32[] memory) { return orchPipelines[w]; }

    function _settle(bytes32 id) internal {
        Meta storage m = metas[id];
        m.status = Status.Settled;
        uint256 paid = 0;
        for (uint256 i = 0; i < slots[id].length; i++) {
            address w = slots[id][i].wallet;
            uint256 v = slots[id][i].payout;
            paid     += v;
            registry.recordDelivery(w, v);
            (bool ok,) = w.call{value: v}("");
            if (!ok) revert TransferFail();
        }
        emit PipelineSettled(id, paid);
    }
}
