// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract AgentRegistry {

    uint256 public constant MIN_STAKE        = 0.001 ether;
    uint256 public constant SLASH_PERCENT    = 100;
    uint256 public constant JAIL_THRESHOLD   = 3;
    uint256 public constant SCORE_SCALE      = 100;

    struct Profile {
        address  wallet;
        uint256  stakedAmount;
        uint256  lockedStake;
        uint256  tasksCompleted;
        uint256  tasksFailed;
        uint256  totalValueDelivered;
        uint256  registeredAt;
        uint256  score;
        bool     available;
        bool     jailed;
    }

    address public solace;
    address public owner;

    mapping(address => Profile)        public profiles;
    mapping(address => string[])       private caps;
    mapping(string  => address[])      private capIndex;
    address[]                          private allAgents;

    event Registered(address indexed wallet, uint256 stake);
    event StakeAdded(address indexed wallet, uint256 amount);
    event StakeLocked(address indexed wallet, uint256 amount);
    event StakeUnlocked(address indexed wallet, uint256 amount);
    event Slashed(address indexed wallet, uint256 slashedAmount, uint256 remaining);
    event Jailed(address indexed wallet);
    event Unjailed(address indexed wallet);
    event AvailabilitySet(address indexed wallet, bool available);
    event DeliveryRecorded(address indexed wallet, uint256 payout, uint256 newScore);
    event FailureRecorded(address indexed wallet, uint256 newScore);
    event CapabilityAdded(address indexed wallet, string cap);

    error NotOwner();
    error NotSolace();
    error AlreadyRegistered();
    error NotRegistered();
    error InsufficientStake();
    error IsJailed();
    error InsufficientAvailableStake();
    error TransferFail();
    error ZeroAddress();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlySolace() {
        if (msg.sender != solace) revert NotSolace();
        _;
    }

    modifier registered(address w) {
        if (profiles[w].wallet == address(0)) revert NotRegistered();
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function setSolace(address _solace) external onlyOwner {
        if (_solace == address(0)) revert ZeroAddress();
        solace = _solace;
    }

    function register(string[] calldata capabilities) external payable {
        if (profiles[msg.sender].wallet != address(0)) revert AlreadyRegistered();
        if (msg.value < MIN_STAKE) revert InsufficientStake();

        profiles[msg.sender] = Profile({
            wallet:             msg.sender,
            stakedAmount:       msg.value,
            lockedStake:        0,
            tasksCompleted:     0,
            tasksFailed:        0,
            totalValueDelivered:0,
            registeredAt:       block.timestamp,
            score:              50,
            available:          true,
            jailed:             false
        });

        for (uint256 i = 0; i < capabilities.length; i++) {
            caps[msg.sender].push(capabilities[i]);
            capIndex[capabilities[i]].push(msg.sender);
        }

        allAgents.push(msg.sender);
        emit Registered(msg.sender, msg.value);
    }

    function addStake() external payable registered(msg.sender) {
        profiles[msg.sender].stakedAmount += msg.value;
        emit StakeAdded(msg.sender, msg.value);
    }

    function lockStake(address wallet, uint256 amount) external onlySolace registered(wallet) {
        Profile storage p = profiles[wallet];
        if (p.stakedAmount - p.lockedStake < amount) revert InsufficientAvailableStake();
        p.lockedStake += amount;
        emit StakeLocked(wallet, amount);
    }

    function unlockStake(address wallet, uint256 amount) external onlySolace registered(wallet) {
        Profile storage p = profiles[wallet];
        if (p.lockedStake < amount) p.lockedStake = 0;
        else p.lockedStake -= amount;
        emit StakeUnlocked(wallet, amount);
    }

    function slashAgent(address wallet) external onlySolace registered(wallet) {
        Profile storage p = profiles[wallet];
        uint256 slashAmount = p.stakedAmount;
        p.stakedAmount  = 0;
        p.lockedStake   = 0;
        p.available     = false;

        if (slashAmount > 0) {
            (bool ok,) = solace.call{value: slashAmount}("");
            if (!ok) revert TransferFail();
        }

        emit Slashed(wallet, slashAmount, 0);

        if (p.tasksFailed >= JAIL_THRESHOLD) {
            p.jailed = true;
            emit Jailed(wallet);
        }
    }

    function recordDelivery(address wallet, uint256 payout) external onlySolace registered(wallet) {
        Profile storage p = profiles[wallet];
        p.tasksCompleted      += 1;
        p.totalValueDelivered += payout;
        p.score                = _computeScore(p.tasksCompleted, p.tasksFailed);
        emit DeliveryRecorded(wallet, payout, p.score);
    }

    function recordFailure(address wallet) external onlySolace registered(wallet) {
        Profile storage p = profiles[wallet];
        p.tasksFailed += 1;
        p.score        = _computeScore(p.tasksCompleted, p.tasksFailed);
        emit FailureRecorded(wallet, p.score);
    }

    function setAvailability(bool avail) external registered(msg.sender) {
        Profile storage p = profiles[msg.sender];
        if (p.jailed) revert IsJailed();
        p.available = avail;
        emit AvailabilitySet(msg.sender, avail);
    }

    function unjail(address wallet) external onlyOwner registered(wallet) {
        profiles[wallet].jailed = false;
        emit Unjailed(wallet);
    }

    function addCapability(string calldata cap) external registered(msg.sender) {
        caps[msg.sender].push(cap);
        capIndex[cap].push(msg.sender);
        emit CapabilityAdded(msg.sender, cap);
    }

    function isRegistered(address wallet) external view returns (bool) {
        return profiles[wallet].wallet != address(0);
    }

    function isAvailable(address wallet) external view returns (bool) {
        Profile storage p = profiles[wallet];
        return p.available && !p.jailed && p.stakedAmount >= MIN_STAKE;
    }

    function isJailed(address wallet) external view returns (bool) {
        return profiles[wallet].jailed;
    }

    function getScore(address wallet) external view returns (uint256) {
        return profiles[wallet].score;
    }

    function getStake(address wallet) external view returns (uint256) {
        return profiles[wallet].stakedAmount;
    }

    function getAvailableStake(address wallet) external view returns (uint256) {
        Profile storage p = profiles[wallet];
        return p.stakedAmount > p.lockedStake ? p.stakedAmount - p.lockedStake : 0;
    }

    function getCapabilities(address wallet) external view returns (string[] memory) {
        return caps[wallet];
    }

    function getAgentsByCapability(string calldata cap) external view returns (address[] memory) {
        return capIndex[cap];
    }

    function getAvailableAgents() external view returns (address[] memory) {
        uint256 count = 0;
        for (uint256 i = 0; i < allAgents.length; i++) {
            Profile storage p = profiles[allAgents[i]];
            if (p.available && !p.jailed && p.stakedAmount >= MIN_STAKE) count++;
        }
        address[] memory result = new address[](count);
        uint256 idx = 0;
        for (uint256 i = 0; i < allAgents.length; i++) {
            Profile storage p = profiles[allAgents[i]];
            if (p.available && !p.jailed && p.stakedAmount >= MIN_STAKE) {
                result[idx++] = allAgents[i];
            }
        }
        return result;
    }

    function getReputation(address wallet) external view returns (
        uint256 completed,
        uint256 failed,
        uint256 valueDelivered,
        uint256 score
    ) {
        Profile storage p = profiles[wallet];
        return (p.tasksCompleted, p.tasksFailed, p.totalValueDelivered, p.score);
    }

    function _computeScore(uint256 completed, uint256 failed) internal pure returns (uint256) {
        uint256 total = completed + failed;
        if (total == 0) return 50;
        uint256 raw = (completed * SCORE_SCALE) / total;
        if (raw > SCORE_SCALE) return SCORE_SCALE;
        return raw;
    }

    receive() external payable {}
}
