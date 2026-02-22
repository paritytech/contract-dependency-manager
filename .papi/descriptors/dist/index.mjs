import {
  __export
} from "./chunk-7P6ASYW6.mjs";

// .papi/descriptors/src/common.ts
var table = new Uint8Array(128);
for (let i = 0; i < 64; i++) table[i < 26 ? i + 65 : i < 52 ? i + 71 : i < 62 ? i - 4 : i * 4 - 205] = i;
var toBinary = (base64) => {
  const n = base64.length, bytes = new Uint8Array((n - Number(base64[n - 1] === "=") - Number(base64[n - 2] === "=")) * 3 / 4 | 0);
  for (let i2 = 0, j = 0; i2 < n; ) {
    const c0 = table[base64.charCodeAt(i2++)], c1 = table[base64.charCodeAt(i2++)];
    const c2 = table[base64.charCodeAt(i2++)], c3 = table[base64.charCodeAt(i2++)];
    bytes[j++] = c0 << 2 | c1 >> 4;
    bytes[j++] = c1 << 4 | c2 >> 2;
    bytes[j++] = c2 << 6 | c3;
  }
  return bytes;
};

// .papi/descriptors/src/relay.ts
var descriptorValues = import("./descriptors-SFUV6UN2.mjs").then((module) => module["Relay"]);
var metadataTypes = import("./metadataTypes-JY4XRAYQ.mjs").then(
  (module) => toBinary("default" in module ? module.default : module)
);
var asset = {};
var extensions = {};
var getMetadata = () => import("./relay_metadata-IQGUE4AA.mjs").then(
  (module) => toBinary("default" in module ? module.default : module)
);
var genesis = "0x91b171bb158e2d3848fa23a9f1c25182fb8e20313b2c1eb49219da7a70ce90c3";
var _allDescriptors = { descriptors: descriptorValues, metadataTypes, asset, extensions, getMetadata, genesis };
var relay_default = _allDescriptors;

// .papi/descriptors/src/individuality.ts
var descriptorValues2 = import("./descriptors-SFUV6UN2.mjs").then((module) => module["Individuality"]);
var metadataTypes2 = import("./metadataTypes-JY4XRAYQ.mjs").then(
  (module) => toBinary("default" in module ? module.default : module)
);
var asset2 = {};
var extensions2 = {};
var getMetadata2 = () => import("./individuality_metadata-YNNF5ORF.mjs").then(
  (module) => toBinary("default" in module ? module.default : module)
);
var genesis2 = void 0;
var _allDescriptors2 = { descriptors: descriptorValues2, metadataTypes: metadataTypes2, asset: asset2, extensions: extensions2, getMetadata: getMetadata2, genesis: genesis2 };
var individuality_default = _allDescriptors2;

// .papi/descriptors/src/assetHub.ts
var descriptorValues3 = import("./descriptors-SFUV6UN2.mjs").then((module) => module["AssetHub"]);
var metadataTypes3 = import("./metadataTypes-JY4XRAYQ.mjs").then(
  (module) => toBinary("default" in module ? module.default : module)
);
var asset3 = {};
var extensions3 = {};
var getMetadata3 = () => import("./assetHub_metadata-HP7CVUOW.mjs").then(
  (module) => toBinary("default" in module ? module.default : module)
);
var genesis3 = "0xa77d4408fe2febf5d403329ab76169c6ebb39b537dd815aafd33a5687412d409";
var _allDescriptors3 = { descriptors: descriptorValues3, metadataTypes: metadataTypes3, asset: asset3, extensions: extensions3, getMetadata: getMetadata3, genesis: genesis3 };
var assetHub_default = _allDescriptors3;

// .papi/descriptors/src/bulletin.ts
var descriptorValues4 = import("./descriptors-SFUV6UN2.mjs").then((module) => module["Bulletin"]);
var metadataTypes4 = import("./metadataTypes-JY4XRAYQ.mjs").then(
  (module) => toBinary("default" in module ? module.default : module)
);
var asset4 = {};
var extensions4 = {};
var getMetadata4 = () => import("./bulletin_metadata-7REQP7XP.mjs").then(
  (module) => toBinary("default" in module ? module.default : module)
);
var genesis4 = "0x5a26fe1a13a254c1ed7600d191b71176f768cc23e9dc0f9a34720cec37d1b1c9";
var _allDescriptors4 = { descriptors: descriptorValues4, metadataTypes: metadataTypes4, asset: asset4, extensions: extensions4, getMetadata: getMetadata4, genesis: genesis4 };
var bulletin_default = _allDescriptors4;

// node_modules/.pnpm/@polkadot-api+substrate-bindings@0.17.0/node_modules/@polkadot-api/substrate-bindings/dist/esm/types/enum.mjs
var discriminant = {
  is(value, type) {
    return value.type === type;
  },
  as(value, type) {
    if (type !== value.type)
      throw new Error(
        `Enum.as(enum, ${type}) used with actual type ${value.type}`
      );
    return value;
  }
};
var Enum = Object.assign((type, value) => {
  return {
    type,
    value
  };
}, discriminant);
var _Enum = new Proxy(
  {},
  {
    get(_, prop) {
      return (value) => Enum(prop, value);
    }
  }
);

// .papi/descriptors/src/common-types.ts
var DigestItem = _Enum;
var Phase = _Enum;
var DispatchClass = _Enum;
var TokenError = _Enum;
var ArithmeticError = _Enum;
var TransactionalError = _Enum;
var PreimageEvent = _Enum;
var BalanceStatus = _Enum;
var TransactionPaymentEvent = _Enum;
var StakingRewardDestination = _Enum;
var StakingForcing = _Enum;
var OffencesEvent = _Enum;
var GrandpaEvent = _Enum;
var XcmV3Junctions = _Enum;
var XcmV3Junction = _Enum;
var XcmV3JunctionNetworkId = _Enum;
var XcmV3JunctionBodyId = _Enum;
var XcmV2JunctionBodyPart = _Enum;
var XcmV3MultiassetAssetId = _Enum;
var XcmV5Junctions = _Enum;
var XcmV5Junction = _Enum;
var XcmV5NetworkId = _Enum;
var XcmVersionedLocation = _Enum;
var ConvictionVotingVoteAccountVote = _Enum;
var PreimagesBounded = _Enum;
var CommonClaimsEvent = _Enum;
var ChildBountiesEvent = _Enum;
var ElectionProviderMultiPhaseEvent = _Enum;
var ElectionProviderMultiPhaseElectionCompute = _Enum;
var ElectionProviderMultiPhasePhase = _Enum;
var BagsListEvent = _Enum;
var NominationPoolsPoolState = _Enum;
var NominationPoolsCommissionClaimPermission = _Enum;
var NominationPoolsClaimPermission = _Enum;
var ParachainsHrmpEvent = _Enum;
var ParachainsDisputesEvent = _Enum;
var ParachainsDisputeLocation = _Enum;
var ParachainsDisputeResult = _Enum;
var CommonParasRegistrarEvent = _Enum;
var CommonSlotsEvent = _Enum;
var CommonAuctionsEvent = _Enum;
var PolkadotRuntimeParachainsCoretimeEvent = _Enum;
var XcmV5Instruction = _Enum;
var XcmV3MultiassetFungibility = _Enum;
var XcmV3MultiassetAssetInstance = _Enum;
var XcmV3MaybeErrorCode = _Enum;
var XcmV2OriginKind = _Enum;
var XcmV5AssetFilter = _Enum;
var XcmV5WildAsset = _Enum;
var XcmV2MultiassetWildFungibility = _Enum;
var XcmV3WeightLimit = _Enum;
var XcmVersionedAssets = _Enum;
var ParachainsInclusionAggregateMessageOrigin = _Enum;
var ParachainsInclusionUmpQueueId = _Enum;
var GovernanceOrigin = _Enum;
var ParachainsOrigin = _Enum;
var PreimageOldRequestStatus = _Enum;
var PreimageRequestStatus = _Enum;
var BabeDigestsNextConfigDescriptor = _Enum;
var BabeAllowedSlots = _Enum;
var BabeDigestsPreDigest = _Enum;
var BalancesTypesReasons = _Enum;
var PreimagePalletHoldReason = _Enum;
var WestendRuntimeRuntimeFreezeReason = _Enum;
var NominationPoolsPalletFreezeReason = _Enum;
var TransactionPaymentReleases = _Enum;
var GrandpaStoredState = _Enum;
var TreasuryPaymentState = _Enum;
var ConvictionVotingVoteVoting = _Enum;
var VotingConviction = _Enum;
var TraitsScheduleDispatchTime = _Enum;
var ClaimsStatementKind = _Enum;
var Version = _Enum;
var ChildBountyStatus = _Enum;
var PolkadotPrimitivesV6ExecutorParamsExecutorParam = _Enum;
var PolkadotPrimitivesV6PvfPrepKind = _Enum;
var PvfExecKind = _Enum;
var ValidityAttestation = _Enum;
var PolkadotPrimitivesV6DisputeStatement = _Enum;
var PolkadotPrimitivesV6ValidDisputeStatementKind = _Enum;
var InvalidDisputeStatementKind = _Enum;
var PolkadotRuntimeParachainsSchedulerCommonAssignment = _Enum;
var ParachainsParasParaLifecycle = _Enum;
var UpgradeGoAhead = _Enum;
var UpgradeRestriction = _Enum;
var BrokerCoretimeInterfaceCoreAssignment = _Enum;
var MultiSigner = _Enum;
var CommonCrowdloanLastContribution = _Enum;
var XcmV3Response = _Enum;
var XcmV3TraitsError = _Enum;
var XcmV4Response = _Enum;
var XcmPalletVersionMigrationStage = _Enum;
var XcmVersionedAssetId = _Enum;
var MultiAddress = _Enum;
var BalancesAdjustmentDirection = _Enum;
var StakingPalletConfigOpBig = _Enum;
var StakingPalletConfigOp = _Enum;
var GrandpaEquivocation = _Enum;
var NominationPoolsBondExtra = _Enum;
var NominationPoolsConfigOp = _Enum;
var MultiSignature = _Enum;
var XcmVersionedXcm = _Enum;
var XcmV3Instruction = _Enum;
var XcmV3MultiassetMultiAssetFilter = _Enum;
var XcmV3MultiassetWildMultiAsset = _Enum;
var XcmV4Instruction = _Enum;
var XcmV4AssetAssetFilter = _Enum;
var XcmV4AssetWildAsset = _Enum;
var ReferendaTypesCurve = _Enum;
var TransactionValidityUnknownTransaction = _Enum;
var TransactionValidityTransactionSource = _Enum;
var OccupiedCoreAssumption = _Enum;
var SlashingOffenceKind = _Enum;
var MmrPrimitivesError = _Enum;
var IdentityData = _Enum;
var XcmVersionedAsset = _Enum;

// .papi/descriptors/src/contracts/index.ts
var contracts_exports = {};
__export(contracts_exports, {
  contractsRegistry: () => descriptor,
  counter: () => descriptor2,
  counterReader: () => descriptor3,
  counterWriter: () => descriptor4
});

// .papi/descriptors/src/contracts/contractsRegistry.ts
var descriptor = { abi: [{ "type": "constructor", "inputs": [], "stateMutability": "nonpayable" }, { "type": "function", "name": "publishLatest", "inputs": [{ "name": "contract_name", "type": "string" }, { "name": "contract_address", "type": "address" }, { "name": "metadata_uri", "type": "string" }], "outputs": [], "stateMutability": "nonpayable" }, { "type": "function", "name": "getAddress", "inputs": [{ "name": "contract_name", "type": "string" }], "outputs": [{ "name": "", "type": "tuple" }], "stateMutability": "view" }, { "type": "function", "name": "getMetadataUri", "inputs": [{ "name": "contract_name", "type": "string" }], "outputs": [{ "name": "", "type": "tuple" }], "stateMutability": "view" }, { "type": "function", "name": "getAddressAtVersion", "inputs": [{ "name": "contract_name", "type": "string" }, { "name": "version", "type": "uint32" }], "outputs": [{ "name": "", "type": "tuple" }], "stateMutability": "view" }, { "type": "function", "name": "getMetadataUriAtVersion", "inputs": [{ "name": "contract_name", "type": "string" }, { "name": "version", "type": "uint32" }], "outputs": [{ "name": "", "type": "tuple" }], "stateMutability": "view" }, { "type": "function", "name": "getContractNameAt", "inputs": [{ "name": "index", "type": "uint32" }], "outputs": [{ "name": "", "type": "string" }], "stateMutability": "view" }, { "type": "function", "name": "getOwner", "inputs": [{ "name": "contract_name", "type": "string" }], "outputs": [{ "name": "", "type": "address" }], "stateMutability": "view" }, { "type": "function", "name": "getVersionCount", "inputs": [{ "name": "contract_name", "type": "string" }], "outputs": [{ "name": "", "type": "uint32" }], "stateMutability": "view" }, { "type": "function", "name": "getContractCount", "inputs": [], "outputs": [{ "name": "", "type": "uint32" }], "stateMutability": "view" }] };

// .papi/descriptors/src/contracts/counter.ts
var descriptor2 = { abi: [{ "type": "constructor", "inputs": [], "stateMutability": "nonpayable" }, { "type": "function", "name": "increment", "inputs": [], "outputs": [], "stateMutability": "nonpayable" }, { "type": "function", "name": "getCount", "inputs": [], "outputs": [{ "name": "", "type": "uint32" }], "stateMutability": "view" }] };

// .papi/descriptors/src/contracts/counterReader.ts
var descriptor3 = { abi: [{ "type": "constructor", "inputs": [], "stateMutability": "nonpayable" }, { "type": "function", "name": "readCount", "inputs": [], "outputs": [{ "name": "", "type": "uint32" }], "stateMutability": "view" }] };

// .papi/descriptors/src/contracts/counterWriter.ts
var descriptor4 = { abi: [{ "type": "constructor", "inputs": [], "stateMutability": "nonpayable" }, { "type": "function", "name": "writeIncrement", "inputs": [], "outputs": [], "stateMutability": "nonpayable" }, { "type": "function", "name": "writeIncrementN", "inputs": [{ "name": "n", "type": "uint32" }], "outputs": [], "stateMutability": "nonpayable" }] };

// .papi/descriptors/src/index.ts
var metadatas = {
  ["0x763725f38b64ed84ae844dfc5d468258d35ef2f090dde5485d5b1afcfc9bf568"]: relay_default,
  ["0x522a2b46e08090b1d32cda20d9d4cd0b30129101f6732001ef3f6697ad2a41cb"]: assetHub_default,
  ["0x4b5246c6f067da11aa539393453b01f26daf7499856317aea480d83e9af0f70c"]: bulletin_default
};
var getMetadata5 = async (codeHash) => {
  try {
    return await metadatas[codeHash].getMetadata();
  } catch {
  }
  return null;
};
export {
  ArithmeticError,
  BabeAllowedSlots,
  BabeDigestsNextConfigDescriptor,
  BabeDigestsPreDigest,
  BagsListEvent,
  BalanceStatus,
  BalancesAdjustmentDirection,
  BalancesTypesReasons,
  BrokerCoretimeInterfaceCoreAssignment,
  ChildBountiesEvent,
  ChildBountyStatus,
  ClaimsStatementKind,
  CommonAuctionsEvent,
  CommonClaimsEvent,
  CommonCrowdloanLastContribution,
  CommonParasRegistrarEvent,
  CommonSlotsEvent,
  ConvictionVotingVoteAccountVote,
  ConvictionVotingVoteVoting,
  DigestItem,
  DispatchClass,
  ElectionProviderMultiPhaseElectionCompute,
  ElectionProviderMultiPhaseEvent,
  ElectionProviderMultiPhasePhase,
  GovernanceOrigin,
  GrandpaEquivocation,
  GrandpaEvent,
  GrandpaStoredState,
  IdentityData,
  InvalidDisputeStatementKind,
  MmrPrimitivesError,
  MultiAddress,
  MultiSignature,
  MultiSigner,
  NominationPoolsBondExtra,
  NominationPoolsClaimPermission,
  NominationPoolsCommissionClaimPermission,
  NominationPoolsConfigOp,
  NominationPoolsPalletFreezeReason,
  NominationPoolsPoolState,
  OccupiedCoreAssumption,
  OffencesEvent,
  ParachainsDisputeLocation,
  ParachainsDisputeResult,
  ParachainsDisputesEvent,
  ParachainsHrmpEvent,
  ParachainsInclusionAggregateMessageOrigin,
  ParachainsInclusionUmpQueueId,
  ParachainsOrigin,
  ParachainsParasParaLifecycle,
  Phase,
  PolkadotPrimitivesV6DisputeStatement,
  PolkadotPrimitivesV6ExecutorParamsExecutorParam,
  PolkadotPrimitivesV6PvfPrepKind,
  PolkadotPrimitivesV6ValidDisputeStatementKind,
  PolkadotRuntimeParachainsCoretimeEvent,
  PolkadotRuntimeParachainsSchedulerCommonAssignment,
  PreimageEvent,
  PreimageOldRequestStatus,
  PreimagePalletHoldReason,
  PreimageRequestStatus,
  PreimagesBounded,
  PvfExecKind,
  ReferendaTypesCurve,
  SlashingOffenceKind,
  StakingForcing,
  StakingPalletConfigOp,
  StakingPalletConfigOpBig,
  StakingRewardDestination,
  TokenError,
  TraitsScheduleDispatchTime,
  TransactionPaymentEvent,
  TransactionPaymentReleases,
  TransactionValidityTransactionSource,
  TransactionValidityUnknownTransaction,
  TransactionalError,
  TreasuryPaymentState,
  UpgradeGoAhead,
  UpgradeRestriction,
  ValidityAttestation,
  Version,
  VotingConviction,
  WestendRuntimeRuntimeFreezeReason,
  XcmPalletVersionMigrationStage,
  XcmV2JunctionBodyPart,
  XcmV2MultiassetWildFungibility,
  XcmV2OriginKind,
  XcmV3Instruction,
  XcmV3Junction,
  XcmV3JunctionBodyId,
  XcmV3JunctionNetworkId,
  XcmV3Junctions,
  XcmV3MaybeErrorCode,
  XcmV3MultiassetAssetId,
  XcmV3MultiassetAssetInstance,
  XcmV3MultiassetFungibility,
  XcmV3MultiassetMultiAssetFilter,
  XcmV3MultiassetWildMultiAsset,
  XcmV3Response,
  XcmV3TraitsError,
  XcmV3WeightLimit,
  XcmV4AssetAssetFilter,
  XcmV4AssetWildAsset,
  XcmV4Instruction,
  XcmV4Response,
  XcmV5AssetFilter,
  XcmV5Instruction,
  XcmV5Junction,
  XcmV5Junctions,
  XcmV5NetworkId,
  XcmV5WildAsset,
  XcmVersionedAsset,
  XcmVersionedAssetId,
  XcmVersionedAssets,
  XcmVersionedLocation,
  XcmVersionedXcm,
  assetHub_default as assetHub,
  bulletin_default as bulletin,
  contracts_exports as contracts,
  getMetadata5 as getMetadata,
  individuality_default as individuality,
  relay_default as relay
};
