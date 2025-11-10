pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract PredictionMarket is ZamaEthereumConfig {
    struct Market {
        string topic;
        euint32 encryptedOdds;
        uint256 totalStaked;
        bool resolved;
        uint32 outcome;
        uint256 creationTime;
        address creator;
    }

    struct Position {
        euint32 encryptedAmount;
        euint32 encryptedDirection;
        address predictor;
        uint256 timestamp;
    }

    mapping(string => Market) public markets;
    mapping(string => Position[]) public positions;
    mapping(string => uint256) public marketResolutionTime;

    event MarketCreated(string indexed topic, address indexed creator);
    event PositionTaken(string indexed topic, address indexed predictor);
    event MarketResolved(string indexed topic, uint32 outcome);

    constructor() ZamaEthereumConfig() {}

    function createMarket(
        string calldata topic,
        externalEuint32 encryptedOdds,
        bytes calldata inputProof
    ) external {
        require(markets[topic].creator == address(0), "Market already exists");
        require(FHE.isInitialized(FHE.fromExternal(encryptedOdds, inputProof)), "Invalid encrypted odds");

        markets[topic] = Market({
            topic: topic,
            encryptedOdds: FHE.fromExternal(encryptedOdds, inputProof),
            totalStaked: 0,
            resolved: false,
            outcome: 0,
            creationTime: block.timestamp,
            creator: msg.sender
        });

        FHE.allowThis(markets[topic].encryptedOdds);
        FHE.makePubliclyDecryptable(markets[topic].encryptedOdds);

        emit MarketCreated(topic, msg.sender);
    }

    function takePosition(
        string calldata topic,
        externalEuint32 encryptedAmount,
        externalEuint32 encryptedDirection,
        bytes calldata amountProof,
        bytes calldata directionProof
    ) external {
        require(markets[topic].creator != address(0), "Market does not exist");
        require(!markets[topic].resolved, "Market already resolved");
        require(FHE.isInitialized(FHE.fromExternal(encryptedAmount, amountProof)), "Invalid encrypted amount");
        require(FHE.isInitialized(FHE.fromExternal(encryptedDirection, directionProof)), "Invalid encrypted direction");

        euint32 amount = FHE.fromExternal(encryptedAmount, amountProof);
        euint32 direction = FHE.fromExternal(encryptedDirection, directionProof);

        positions[topic].push(Position({
            encryptedAmount: amount,
            encryptedDirection: direction,
            predictor: msg.sender,
            timestamp: block.timestamp
        }));

        FHE.allowThis(amount);
        FHE.allowThis(direction);
        FHE.makePubliclyDecryptable(amount);
        FHE.makePubliclyDecryptable(direction);

        markets[topic].totalStaked += FHE.decrypt(amount, amountProof).value;
        emit PositionTaken(topic, msg.sender);
    }

    function resolveMarket(
        string calldata topic,
        uint32 outcome,
        bytes memory decryptionProof
    ) external {
        require(markets[topic].creator != address(0), "Market does not exist");
        require(!markets[topic].resolved, "Market already resolved");
        require(msg.sender == markets[topic].creator, "Only creator can resolve");

        markets[topic].resolved = true;
        markets[topic].outcome = outcome;
        marketResolutionTime[topic] = block.timestamp;

        distributeWinnings(topic, decryptionProof);
        emit MarketResolved(topic, outcome);
    }

    function distributeWinnings(
        string calldata topic,
        bytes memory decryptionProof
    ) internal {
        uint256 totalWinners;
        uint256 totalStaked = markets[topic].totalStaked;

        for (uint256 i = 0; i < positions[topic].length; i++) {
            Position storage position = positions[topic][i];
            uint32 direction = FHE.decrypt(position.encryptedDirection, decryptionProof).value;

            if (direction == markets[topic].outcome) {
                totalWinners++;
            }
        }

        for (uint256 i = 0; i < positions[topic].length; i++) {
            Position storage position = positions[topic][i];
            uint32 amount = FHE.decrypt(position.encryptedAmount, decryptionProof).value;
            uint32 direction = FHE.decrypt(position.encryptedDirection, decryptionProof).value;

            if (direction == markets[topic].outcome) {
                uint256 payout = (totalStaked / totalWinners) * amount;
                payable(position.predictor).transfer(payout);
            }
        }
    }

    function getMarketDetails(string calldata topic) external view returns (
        string memory,
        euint32,
        uint256,
        bool,
        uint32,
        uint256,
        address
    ) {
        require(markets[topic].creator != address(0), "Market does not exist");
        Market storage market = markets[topic];
        return (
            market.topic,
            market.encryptedOdds,
            market.totalStaked,
            market.resolved,
            market.outcome,
            market.creationTime,
            market.creator
        );
    }

    function getPositionCount(string calldata topic) external view returns (uint256) {
        return positions[topic].length;
    }

    function getPosition(string calldata topic, uint256 index) external view returns (
        euint32,
        euint32,
        address,
        uint256
    ) {
        require(index < positions[topic].length, "Invalid position index");
        Position storage position = positions[topic][index];
        return (
            position.encryptedAmount,
            position.encryptedDirection,
            position.predictor,
            position.timestamp
        );
    }

    function getResolutionTime(string calldata topic) external view returns (uint256) {
        require(markets[topic].resolved, "Market not resolved");
        return marketResolutionTime[topic];
    }

    function isMarketActive(string calldata topic) external view returns (bool) {
        return !markets[topic].resolved && markets[topic].creator != address(0);
    }
}


