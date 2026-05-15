import { HardhatUserConfig } from "hardhat/config";
import "@parity/hardhat-polkadot";

const config: HardhatUserConfig = {
    solidity: {
        version: "0.8.28",
        settings: {
            optimizer: {
                enabled: true,
                runs: 200,
            },
        },
    },
    networks: {
        hardhat: {
            polkadot: true,
            nodeConfig: {
                nodeBinaryPath: process.env.ANVIL_POLKADOT_BINARY ?? "./bin/anvil-polkadot",
            },
        },
    },
};

export default config;
