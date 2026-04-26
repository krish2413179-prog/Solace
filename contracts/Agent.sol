// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract AgentRegistry {

    uint256 public constant MIN_STAKE     = 0.01 ether;
    uint256 public constant SLASH_PERCENT = 20;

    struct AgentProfile {
        address wallet;
        uint256 stakedAmount;
        uint256 tasksCompleted;
        uint256 tasksFailed;
        uint256 totalValueDelivered;
        uint256 registeredAt;
        bool    available;
        bool    jailed;
        string  axlPeerId;
    }

    mapping(address => AgentProfile)            public  profiles;
    mapping(address => string[])                private capabilities;
    address[]                                   public  registeredAgents;
    address                                     public  solaceContract;
    address                                     public  owner;

    event AgentRegistered(address indexed wallet, uint256 stake, string axlPeerId);
    event AgentDeregistered(address indexed wallet, uint256 stakeReturned);
    event AgentJailed(address indexed wallet, uint256 slashed);
    event AgentUnjailed(address indexed wallet);
    event CapabilitiesUpdated(address indexed wallet);
    event SolaceContractSet(address indexed solace);

    error AlreadyRegistered();
    error NotRegistered();
    error InsufficientStake();
    error EmptyCapabilities();
    error EmptyPeerId();
    error IsJailed();
    error NotJailed();
    error TransferFailed();
    error Unauthorized();

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    modifier onlySolace() {
        if (msg.sender != solaceContract) revert Unauthorized();
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function setSolaceContract(address _solace) external onlyOwner {
        solaceContract = _solace;
        emit SolaceContractSet(_solace);
    }

    function registerAgent(
        string[] calldata caps,
        string   calldata peerId
    ) external payable {
        if (profiles[msg.sender].wallet != address(0)) revert AlreadyRegistered();
        if (msg.value < MIN_STAKE)                     revert InsufficientStake();
        if (caps.length == 0)                          revert EmptyCapabilities();
        if (bytes(peerId).length == 0)                 revert EmptyPeerId();

        profiles[msg.sender] = AgentProfile({
            wallet:              msg.sender,
            stakedAmount:        msg.value,
            tasksCompleted:      0,
            tasksFailed:         0,
            totalValueDelivered: 0,
            registeredAt:        block.timestamp,
            available:           true,
            jailed:              false,
            axlPeerId:           peerId
        });

        for (uint256 i = 0; i < caps.length; i++) {
            capabilities[msg.sender].push(caps[i]);
        }

        registeredAgents.push(msg.sender);
        emit AgentRegistered(msg.sender, msg.value, peerId);
    }

    function deregisterAgent() external {
        AgentProfile storage p = profiles[msg.sender];
        if (p.wallet == address(0)) revert NotRegistered();
        if (p.jailed)               revert IsJailed();

        uint256 stake  = p.stakedAmount;
        p.stakedAmount = 0;
        p.available    = false;

        for (uint256 i = 0; i < registeredAgents.length; i++) {
            if (registeredAgents[i] == msg.sender) {
                registeredAgents[i] = registeredAgents[registeredAgents.length - 1];
                registeredAgents.pop();
                break;
            }
        }

        delete capabilities[msg.sender];

        (bool ok,) = msg.sender.call{value: stake}("");
        if (!ok) revert TransferFailed();
        emit AgentDeregistered(msg.sender, stake);
    }

    function setAvailability(bool val) external {
        if (profiles[msg.sender].wallet == address(0)) revert NotRegistered();
        profiles[msg.sender].available = val;
    }

    function updateCapabilities(string[] calldata caps) external {
        if (profiles[msg.sender].wallet == address(0)) revert NotRegistered();
        if (caps.length == 0)                          revert EmptyCapabilities();

        delete capabilities[msg.sender];
        for (uint256 i = 0; i < caps.length; i++) {
            capabilities[msg.sender].push(caps[i]);
        }

        emit CapabilitiesUpdated(msg.sender);
    }

    function addStake() external payable {
        if (profiles[msg.sender].wallet == address(0)) revert NotRegistered();
        profiles[msg.sender].stakedAmount += msg.value;
    }

    function slashAgent(address wallet) external onlySolace {
        AgentProfile storage p = profiles[wallet];
        if (p.wallet == address(0)) return;
        uint256 cut    = (p.stakedAmount * SLASH_PERCENT) / 100;
        p.stakedAmount -= cut;
        p.jailed        = true;
        p.available     = false;
        emit AgentJailed(wallet, cut);
    }

    function recordDelivery(address wallet, uint256 payout) external onlySolace {
        AgentProfile storage p = profiles[wallet];
        if (p.wallet == address(0)) return;
        p.tasksCompleted      += 1;
        p.totalValueDelivered += payout;
    }

    function recordFailure(address wallet) external onlySolace {
        AgentProfile storage p = profiles[wallet];
        if (p.wallet == address(0)) return;
        p.tasksFailed += 1;
    }

    function unjailAgent(address wallet) external onlyOwner {
        AgentProfile storage p = profiles[wallet];
        if (p.wallet == address(0)) revert NotRegistered();
        if (!p.jailed)              revert NotJailed();
        p.jailed    = false;
        p.available = true;
        emit AgentUnjailed(wallet);
    }

    function isRegistered(address wallet) external view returns (bool) {
        return profiles[wallet].wallet != address(0);
    }

    function isAvailable(address wallet) external view returns (bool) {
        AgentProfile storage p = profiles[wallet];
        return p.wallet != address(0) && p.available && !p.jailed;
    }

    function isJailed(address wallet) external view returns (bool) {
        return profiles[wallet].jailed;
    }

    function getAxlPeerId(address wallet) external view returns (string memory) {
        return profiles[wallet].axlPeerId;
    }

    function getCapabilities(address wallet) external view returns (string[] memory) {
        return capabilities[wallet];
    }

    function getReputation(address wallet)
        external view
        returns (
            uint256 completed,
            uint256 failed,
            uint256 valueDelivered,
            uint256 score
        )
    {
        AgentProfile storage p = profiles[wallet];
        uint256 total = p.tasksCompleted + p.tasksFailed;
        uint256 s     = total == 0 ? 100 : (p.tasksCompleted * 100) / total;
        return (p.tasksCompleted, p.tasksFailed, p.totalValueDelivered, s);
    }

    function getAgentsByCapability(string calldata cap) external view returns (address[] memory) {
        uint256 count = 0;
        for (uint256 i = 0; i < registeredAgents.length; i++) {
            AgentProfile storage p = profiles[registeredAgents[i]];
            if (p.available && !p.jailed && _hasCap(registeredAgents[i], cap)) count++;
        }
        address[] memory result = new address[](count);
        uint256 j = 0;
        for (uint256 i = 0; i < registeredAgents.length; i++) {
            AgentProfile storage p = profiles[registeredAgents[i]];
            if (p.available && !p.jailed && _hasCap(registeredAgents[i], cap)) result[j++] = registeredAgents[i];
        }
        return result;
    }

    function getAvailableAgents() external view returns (address[] memory) {
        uint256 count = 0;
        for (uint256 i = 0; i < registeredAgents.length; i++) {
            AgentProfile storage p = profiles[registeredAgents[i]];
            if (p.available && !p.jailed) count++;
        }
        address[] memory result = new address[](count);
        uint256 j = 0;
        for (uint256 i = 0; i < registeredAgents.length; i++) {
            AgentProfile storage p = profiles[registeredAgents[i]];
            if (p.available && !p.jailed) result[j++] = registeredAgents[i];
        }
        return result;
    }

    function getRegisteredCount() external view returns (uint256) {
        return registeredAgents.length;
    }

    function hasCapability(address wallet, string calldata cap) external view returns (bool) {
        return _hasCap(wallet, cap);
    }

    function _hasCap(address wallet, string calldata target) internal view returns (bool) {
        bytes32 h    = keccak256(bytes(target));
        string[] storage caps = capabilities[wallet];
        for (uint256 i = 0; i < caps.length; i++) {
            if (keccak256(bytes(caps[i])) == h) return true;
        }
        return false;
    }
}
