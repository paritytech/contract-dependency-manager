import { Enum, GetEnum, FixedSizeBinary, Binary, SS58String, ResultPayload, FixedSizeArray, TxCallData } from "polkadot-api";
type AnonymousEnum<T extends {}> = T & {
    __anonymous: true;
};
type MyTuple<T> = [T, ...T[]];
type SeparateUndefined<T> = undefined extends T ? undefined | Exclude<T, undefined> : T;
type Anonymize<T> = SeparateUndefined<T extends FixedSizeBinary<infer L> ? number extends L ? Binary : FixedSizeBinary<L> : T extends string | number | bigint | boolean | void | undefined | null | symbol | Uint8Array | Enum<any> ? T : T extends AnonymousEnum<infer V> ? Enum<V> : T extends MyTuple<any> ? {
    [K in keyof T]: T[K];
} : T extends [] ? [] : T extends FixedSizeArray<infer L, infer T> ? number extends L ? Array<T> : FixedSizeArray<L, T> : {
    [K in keyof T & string]: T[K];
}>;
export type I5sesotjlssv2d = {
    "nonce": number;
    "consumers": number;
    "providers": number;
    "sufficients": number;
    "data": Anonymize<I1q8tnt1cluu5j>;
};
export type I1q8tnt1cluu5j = {
    "free": bigint;
    "reserved": bigint;
    "frozen": bigint;
    "flags": bigint;
};
export type Iffmde3ekjedi9 = {
    "normal": Anonymize<I4q39t5hn830vp>;
    "operational": Anonymize<I4q39t5hn830vp>;
    "mandatory": Anonymize<I4q39t5hn830vp>;
};
export type I4q39t5hn830vp = {
    "ref_time": bigint;
    "proof_size": bigint;
};
export type I4mddgoa69c0a2 = Array<DigestItem>;
export type DigestItem = Enum<{
    "PreRuntime": Anonymize<I82jm9g7pufuel>;
    "Consensus": Anonymize<I82jm9g7pufuel>;
    "Seal": Anonymize<I82jm9g7pufuel>;
    "Other": Binary;
    "RuntimeEnvironmentUpdated": undefined;
}>;
export declare const DigestItem: GetEnum<DigestItem>;
export type I82jm9g7pufuel = [FixedSizeBinary<4>, Binary];
export type Ic1qn45u9b9hhu = Array<{
    "phase": Phase;
    "event": Anonymize<I1rke1a43hqelf>;
    "topics": Anonymize<Ic5m5lp1oioo8r>;
}>;
export type Phase = Enum<{
    "ApplyExtrinsic": number;
    "Finalization": undefined;
    "Initialization": undefined;
}>;
export declare const Phase: GetEnum<Phase>;
export type I1rke1a43hqelf = AnonymousEnum<{
    "System": Anonymize<It0dac3277no5>;
    "ParachainSystem": Anonymize<Icbsekf57miplo>;
    "Utility": Anonymize<Iaouq041baf2nh>;
    "Balances": Anonymize<Ifhlvt8s3bh824>;
    "TransactionPayment": TransactionPaymentEvent;
    "SkipFeelessPayment": Anonymize<Idkntqrg9tr7h7>;
    "TransactionStorage": Anonymize<I6a9k53vnitigf>;
    "CollatorSelection": Anonymize<I4srakrmf0fspo>;
    "Session": Anonymize<I6ue0ck5fc3u44>;
    "XcmpQueue": Anonymize<Idsqc7mhp6nnle>;
    "PolkadotXcm": Anonymize<If95hivmqmkiku>;
    "CumulusXcm": Anonymize<I5uv57c3fffoi9>;
    "MessageQueue": Anonymize<I2kosejppk3jon>;
    "Sudo": Anonymize<I4mr5fuq4vs8tb>;
}>;
export type It0dac3277no5 = AnonymousEnum<{
    /**
     * An extrinsic completed successfully.
     */
    "ExtrinsicSuccess": Anonymize<Ia82mnkmeo2rhc>;
    /**
     * An extrinsic failed.
     */
    "ExtrinsicFailed": Anonymize<Icsa46bnbuohqc>;
    /**
     * `:code` was updated.
     */
    "CodeUpdated": undefined;
    /**
     * A new account was created.
     */
    "NewAccount": Anonymize<Icbccs0ug47ilf>;
    /**
     * An account was reaped.
     */
    "KilledAccount": Anonymize<Icbccs0ug47ilf>;
    /**
     * On on-chain remark happened.
     */
    "Remarked": Anonymize<I855j4i3kr8ko1>;
    /**
     * An upgrade was authorized.
     */
    "UpgradeAuthorized": Anonymize<Ibgl04rn6nbfm6>;
    /**
     * An invalid authorized upgrade was rejected while trying to apply it.
     */
    "RejectedInvalidAuthorizedUpgrade": Anonymize<I67n6mbhp91nlg>;
}>;
export type Ia82mnkmeo2rhc = {
    "dispatch_info": Anonymize<Ic9s8f85vjtncc>;
};
export type Ic9s8f85vjtncc = {
    "weight": Anonymize<I4q39t5hn830vp>;
    "class": DispatchClass;
    "pays_fee": Anonymize<Iehg04bj71rkd>;
};
export type DispatchClass = Enum<{
    "Normal": undefined;
    "Operational": undefined;
    "Mandatory": undefined;
}>;
export declare const DispatchClass: GetEnum<DispatchClass>;
export type Iehg04bj71rkd = AnonymousEnum<{
    "Yes": undefined;
    "No": undefined;
}>;
export type Icsa46bnbuohqc = {
    "dispatch_error": Anonymize<Id3cclc8rha27v>;
    "dispatch_info": Anonymize<Ic9s8f85vjtncc>;
};
export type Id3cclc8rha27v = AnonymousEnum<{
    "Other": undefined;
    "CannotLookup": undefined;
    "BadOrigin": undefined;
    "Module": Enum<{
        "System": Anonymize<I5o0s7c8q1cc9b>;
        "ParachainSystem": Anonymize<Icjkr35j4tmg7k>;
        "Timestamp": undefined;
        "ParachainInfo": undefined;
        "WeightReclaim": undefined;
        "Utility": Anonymize<I8dt2g2hcrgh36>;
        "Balances": Anonymize<Idj13i7adlomht>;
        "TransactionPayment": undefined;
        "SkipFeelessPayment": undefined;
        "TransactionStorage": Anonymize<I3t32lkif2hg4k>;
        "Authorship": undefined;
        "CollatorSelection": Anonymize<I36bcffk2387dv>;
        "Session": Anonymize<I1e07dgbaqd1sq>;
        "Aura": undefined;
        "AuraExt": undefined;
        "XcmpQueue": Anonymize<Idnnbndsjjeqqs>;
        "PolkadotXcm": Anonymize<I4vcvo9od6afmt>;
        "CumulusXcm": undefined;
        "MessageQueue": Anonymize<I5iupade5ag2dp>;
        "Sudo": Anonymize<Iaug04qjhbli00>;
    }>;
    "ConsumerRemaining": undefined;
    "NoProviders": undefined;
    "TooManyConsumers": undefined;
    "Token": TokenError;
    "Arithmetic": ArithmeticError;
    "Transactional": TransactionalError;
    "Exhausted": undefined;
    "Corruption": undefined;
    "Unavailable": undefined;
    "RootNotAllowed": undefined;
    "Trie": Enum<{
        "InvalidStateRoot": undefined;
        "IncompleteDatabase": undefined;
        "ValueAtIncompleteKey": undefined;
        "DecoderError": undefined;
        "InvalidHash": undefined;
        "DuplicateKey": undefined;
        "ExtraneousNode": undefined;
        "ExtraneousValue": undefined;
        "ExtraneousHashReference": undefined;
        "InvalidChildReference": undefined;
        "ValueMismatch": undefined;
        "IncompleteProof": undefined;
        "RootMismatch": undefined;
        "DecodeError": undefined;
    }>;
}>;
export type I5o0s7c8q1cc9b = AnonymousEnum<{
    /**
     * The name of specification does not match between the current runtime
     * and the new runtime.
     */
    "InvalidSpecName": undefined;
    /**
     * The specification version is not allowed to decrease between the current runtime
     * and the new runtime.
     */
    "SpecVersionNeedsToIncrease": undefined;
    /**
     * Failed to extract the runtime version from the new runtime.
     *
     * Either calling `Core_version` or decoding `RuntimeVersion` failed.
     */
    "FailedToExtractRuntimeVersion": undefined;
    /**
     * Suicide called when the account has non-default composite data.
     */
    "NonDefaultComposite": undefined;
    /**
     * There is a non-zero reference count preventing the account from being purged.
     */
    "NonZeroRefCount": undefined;
    /**
     * The origin filter prevent the call to be dispatched.
     */
    "CallFiltered": undefined;
    /**
     * A multi-block migration is ongoing and prevents the current code from being replaced.
     */
    "MultiBlockMigrationsOngoing": undefined;
    /**
     * No upgrade authorized.
     */
    "NothingAuthorized": undefined;
    /**
     * The submitted code is not authorized.
     */
    "Unauthorized": undefined;
}>;
export type Icjkr35j4tmg7k = AnonymousEnum<{
    /**
     * Attempt to upgrade validation function while existing upgrade pending.
     */
    "OverlappingUpgrades": undefined;
    /**
     * Polkadot currently prohibits this parachain from upgrading its validation function.
     */
    "ProhibitedByPolkadot": undefined;
    /**
     * The supplied validation function has compiled into a blob larger than Polkadot is
     * willing to run.
     */
    "TooBig": undefined;
    /**
     * The inherent which supplies the validation data did not run this block.
     */
    "ValidationDataNotAvailable": undefined;
    /**
     * The inherent which supplies the host configuration did not run this block.
     */
    "HostConfigurationNotAvailable": undefined;
    /**
     * No validation function upgrade is currently scheduled.
     */
    "NotScheduled": undefined;
}>;
export type I8dt2g2hcrgh36 = AnonymousEnum<{
    /**
     * Too many calls batched.
     */
    "TooManyCalls": undefined;
}>;
export type Idj13i7adlomht = AnonymousEnum<{
    /**
     * Vesting balance too high to send value.
     */
    "VestingBalance": undefined;
    /**
     * Account liquidity restrictions prevent withdrawal.
     */
    "LiquidityRestrictions": undefined;
    /**
     * Balance too low to send value.
     */
    "InsufficientBalance": undefined;
    /**
     * Value too low to create account due to existential deposit.
     */
    "ExistentialDeposit": undefined;
    /**
     * Transfer/payment would kill account.
     */
    "Expendability": undefined;
    /**
     * A vesting schedule already exists for this account.
     */
    "ExistingVestingSchedule": undefined;
    /**
     * Beneficiary account must pre-exist.
     */
    "DeadAccount": undefined;
    /**
     * Number of named reserves exceed `MaxReserves`.
     */
    "TooManyReserves": undefined;
    /**
     * Number of holds exceed `VariantCountOf<T::RuntimeHoldReason>`.
     */
    "TooManyHolds": undefined;
    /**
     * Number of freezes exceed `MaxFreezes`.
     */
    "TooManyFreezes": undefined;
    /**
     * The issuance cannot be modified since it is already deactivated.
     */
    "IssuanceDeactivated": undefined;
    /**
     * The delta cannot be zero.
     */
    "DeltaZero": undefined;
}>;
export type I3t32lkif2hg4k = AnonymousEnum<{
    /**
     * Attempted to call `store`/`renew` outside of block execution.
     */
    "BadContext": undefined;
    /**
     * Data size is not in the allowed range.
     */
    "BadDataSize": undefined;
    /**
     * Too many transactions in the block.
     */
    "TooManyTransactions": undefined;
    /**
     * Invalid configuration.
     */
    "NotConfigured": undefined;
    /**
     * Renewed extrinsic is not found.
     */
    "RenewedNotFound": undefined;
    /**
     * Proof was not expected in this block.
     */
    "UnexpectedProof": undefined;
    /**
     * Proof failed verification.
     */
    "InvalidProof": undefined;
    /**
     * Missing storage proof.
     */
    "MissingProof": undefined;
    /**
     * Unable to verify proof because state data is missing.
     */
    "MissingStateData": undefined;
    /**
     * Double proof check in the block.
     */
    "DoubleCheck": undefined;
    /**
     * Storage proof was not checked in the block.
     */
    "ProofNotChecked": undefined;
    /**
     * Authorization was not found.
     */
    "AuthorizationNotFound": undefined;
    /**
     * Authorization has not expired.
     */
    "AuthorizationNotExpired": undefined;
    /**
     * Content hash was not calculated.
     */
    "InvalidContentHash": undefined;
}>;
export type I36bcffk2387dv = AnonymousEnum<{
    /**
     * The pallet has too many candidates.
     */
    "TooManyCandidates": undefined;
    /**
     * Leaving would result in too few candidates.
     */
    "TooFewEligibleCollators": undefined;
    /**
     * Account is already a candidate.
     */
    "AlreadyCandidate": undefined;
    /**
     * Account is not a candidate.
     */
    "NotCandidate": undefined;
    /**
     * There are too many Invulnerables.
     */
    "TooManyInvulnerables": undefined;
    /**
     * Account is already an Invulnerable.
     */
    "AlreadyInvulnerable": undefined;
    /**
     * Account is not an Invulnerable.
     */
    "NotInvulnerable": undefined;
    /**
     * Account has no associated validator ID.
     */
    "NoAssociatedValidatorId": undefined;
    /**
     * Validator ID is not yet registered.
     */
    "ValidatorNotRegistered": undefined;
    /**
     * Could not insert in the candidate list.
     */
    "InsertToCandidateListFailed": undefined;
    /**
     * Could not remove from the candidate list.
     */
    "RemoveFromCandidateListFailed": undefined;
    /**
     * New deposit amount would be below the minimum candidacy bond.
     */
    "DepositTooLow": undefined;
    /**
     * Could not update the candidate list.
     */
    "UpdateCandidateListFailed": undefined;
    /**
     * Deposit amount is too low to take the target's slot in the candidate list.
     */
    "InsufficientBond": undefined;
    /**
     * The target account to be replaced in the candidate list is not a candidate.
     */
    "TargetIsNotCandidate": undefined;
    /**
     * The updated deposit amount is equal to the amount already reserved.
     */
    "IdenticalDeposit": undefined;
    /**
     * Cannot lower candidacy bond while occupying a future collator slot in the list.
     */
    "InvalidUnreserve": undefined;
}>;
export type I1e07dgbaqd1sq = AnonymousEnum<{
    /**
     * Invalid ownership proof.
     */
    "InvalidProof": undefined;
    /**
     * No associated validator ID for account.
     */
    "NoAssociatedValidatorId": undefined;
    /**
     * Registered duplicate key.
     */
    "DuplicatedKey": undefined;
    /**
     * No keys are associated with this account.
     */
    "NoKeys": undefined;
    /**
     * Key setting account is not live, so it's impossible to associate keys.
     */
    "NoAccount": undefined;
}>;
export type Idnnbndsjjeqqs = AnonymousEnum<{
    /**
     * Setting the queue config failed since one of its values was invalid.
     */
    "BadQueueConfig": undefined;
    /**
     * The execution is already suspended.
     */
    "AlreadySuspended": undefined;
    /**
     * The execution is already resumed.
     */
    "AlreadyResumed": undefined;
    /**
     * There are too many active outbound channels.
     */
    "TooManyActiveOutboundChannels": undefined;
    /**
     * The message is too big.
     */
    "TooBig": undefined;
}>;
export type I4vcvo9od6afmt = AnonymousEnum<{
    /**
     * The desired destination was unreachable, generally because there is a no way of routing
     * to it.
     */
    "Unreachable": undefined;
    /**
     * There was some other issue (i.e. not to do with routing) in sending the message.
     * Perhaps a lack of space for buffering the message.
     */
    "SendFailure": undefined;
    /**
     * The message execution fails the filter.
     */
    "Filtered": undefined;
    /**
     * The message's weight could not be determined.
     */
    "UnweighableMessage": undefined;
    /**
     * The destination `Location` provided cannot be inverted.
     */
    "DestinationNotInvertible": undefined;
    /**
     * The assets to be sent are empty.
     */
    "Empty": undefined;
    /**
     * Could not re-anchor the assets to declare the fees for the destination chain.
     */
    "CannotReanchor": undefined;
    /**
     * Too many assets have been attempted for transfer.
     */
    "TooManyAssets": undefined;
    /**
     * Origin is invalid for sending.
     */
    "InvalidOrigin": undefined;
    /**
     * The version of the `Versioned` value used is not able to be interpreted.
     */
    "BadVersion": undefined;
    /**
     * The given location could not be used (e.g. because it cannot be expressed in the
     * desired version of XCM).
     */
    "BadLocation": undefined;
    /**
     * The referenced subscription could not be found.
     */
    "NoSubscription": undefined;
    /**
     * The location is invalid since it already has a subscription from us.
     */
    "AlreadySubscribed": undefined;
    /**
     * Could not check-out the assets for teleportation to the destination chain.
     */
    "CannotCheckOutTeleport": undefined;
    /**
     * The owner does not own (all) of the asset that they wish to do the operation on.
     */
    "LowBalance": undefined;
    /**
     * The asset owner has too many locks on the asset.
     */
    "TooManyLocks": undefined;
    /**
     * The given account is not an identifiable sovereign account for any location.
     */
    "AccountNotSovereign": undefined;
    /**
     * The operation required fees to be paid which the initiator could not meet.
     */
    "FeesNotMet": undefined;
    /**
     * A remote lock with the corresponding data could not be found.
     */
    "LockNotFound": undefined;
    /**
     * The unlock operation cannot succeed because there are still consumers of the lock.
     */
    "InUse": undefined;
    /**
     * Invalid asset, reserve chain could not be determined for it.
     */
    "InvalidAssetUnknownReserve": undefined;
    /**
     * Invalid asset, do not support remote asset reserves with different fees reserves.
     */
    "InvalidAssetUnsupportedReserve": undefined;
    /**
     * Too many assets with different reserve locations have been attempted for transfer.
     */
    "TooManyReserves": undefined;
    /**
     * Local XCM execution incomplete.
     */
    "LocalExecutionIncomplete": undefined;
    /**
     * Too many locations authorized to alias origin.
     */
    "TooManyAuthorizedAliases": undefined;
    /**
     * Expiry block number is in the past.
     */
    "ExpiresInPast": undefined;
    /**
     * The alias to remove authorization for was not found.
     */
    "AliasNotFound": undefined;
    /**
     * Local XCM execution incomplete with the actual XCM error and the index of the
     * instruction that caused the error.
     */
    "LocalExecutionIncompleteWithError": Anonymize<I5r8t4iaend96p>;
}>;
export type I5r8t4iaend96p = {
    "index": number;
    "error": Enum<{
        "Overflow": undefined;
        "Unimplemented": undefined;
        "UntrustedReserveLocation": undefined;
        "UntrustedTeleportLocation": undefined;
        "LocationFull": undefined;
        "LocationNotInvertible": undefined;
        "BadOrigin": undefined;
        "InvalidLocation": undefined;
        "AssetNotFound": undefined;
        "FailedToTransactAsset": undefined;
        "NotWithdrawable": undefined;
        "LocationCannotHold": undefined;
        "ExceedsMaxMessageSize": undefined;
        "DestinationUnsupported": undefined;
        "Transport": undefined;
        "Unroutable": undefined;
        "UnknownClaim": undefined;
        "FailedToDecode": undefined;
        "MaxWeightInvalid": undefined;
        "NotHoldingFees": undefined;
        "TooExpensive": undefined;
        "Trap": undefined;
        "ExpectationFalse": undefined;
        "PalletNotFound": undefined;
        "NameMismatch": undefined;
        "VersionIncompatible": undefined;
        "HoldingWouldOverflow": undefined;
        "ExportError": undefined;
        "ReanchorFailed": undefined;
        "NoDeal": undefined;
        "FeesNotMet": undefined;
        "LockError": undefined;
        "NoPermission": undefined;
        "Unanchored": undefined;
        "NotDepositable": undefined;
        "TooManyAssets": undefined;
        "UnhandledXcmVersion": undefined;
        "WeightLimitReached": undefined;
        "Barrier": undefined;
        "WeightNotComputable": undefined;
        "ExceedsStackLimit": undefined;
    }>;
};
export type I5iupade5ag2dp = AnonymousEnum<{
    /**
     * Page is not reapable because it has items remaining to be processed and is not old
     * enough.
     */
    "NotReapable": undefined;
    /**
     * Page to be reaped does not exist.
     */
    "NoPage": undefined;
    /**
     * The referenced message could not be found.
     */
    "NoMessage": undefined;
    /**
     * The message was already processed and cannot be processed again.
     */
    "AlreadyProcessed": undefined;
    /**
     * The message is queued for future execution.
     */
    "Queued": undefined;
    /**
     * There is temporarily not enough weight to continue servicing messages.
     */
    "InsufficientWeight": undefined;
    /**
     * This message is temporarily unprocessable.
     *
     * Such errors are expected, but not guaranteed, to resolve themselves eventually through
     * retrying.
     */
    "TemporarilyUnprocessable": undefined;
    /**
     * The queue is paused and no message can be executed from it.
     *
     * This can change at any time and may resolve in the future by re-trying.
     */
    "QueuePaused": undefined;
    /**
     * Another call is in progress and needs to finish before this call can happen.
     */
    "RecursiveDisallowed": undefined;
}>;
export type Iaug04qjhbli00 = AnonymousEnum<{
    /**
     * Sender must be the Sudo account.
     */
    "RequireSudo": undefined;
}>;
export type TokenError = Enum<{
    "FundsUnavailable": undefined;
    "OnlyProvider": undefined;
    "BelowMinimum": undefined;
    "CannotCreate": undefined;
    "UnknownAsset": undefined;
    "Frozen": undefined;
    "Unsupported": undefined;
    "CannotCreateHold": undefined;
    "NotExpendable": undefined;
    "Blocked": undefined;
}>;
export declare const TokenError: GetEnum<TokenError>;
export type ArithmeticError = Enum<{
    "Underflow": undefined;
    "Overflow": undefined;
    "DivisionByZero": undefined;
}>;
export declare const ArithmeticError: GetEnum<ArithmeticError>;
export type TransactionalError = Enum<{
    "LimitReached": undefined;
    "NoLayer": undefined;
}>;
export declare const TransactionalError: GetEnum<TransactionalError>;
export type Icbccs0ug47ilf = {
    "account": SS58String;
};
export type I855j4i3kr8ko1 = {
    "sender": SS58String;
    "hash": FixedSizeBinary<32>;
};
export type Ibgl04rn6nbfm6 = {
    "code_hash": FixedSizeBinary<32>;
    "check_version": boolean;
};
export type I67n6mbhp91nlg = {
    "code_hash": FixedSizeBinary<32>;
    "error": Anonymize<Id3cclc8rha27v>;
};
export type Icbsekf57miplo = AnonymousEnum<{
    /**
     * The validation function has been scheduled to apply.
     */
    "ValidationFunctionStored": undefined;
    /**
     * The validation function was applied as of the contained relay chain block number.
     */
    "ValidationFunctionApplied": Anonymize<Idd7hd99u0ho0n>;
    /**
     * The relay-chain aborted the upgrade process.
     */
    "ValidationFunctionDiscarded": undefined;
    /**
     * Some downward messages have been received and will be processed.
     */
    "DownwardMessagesReceived": Anonymize<Iafscmv8tjf0ou>;
    /**
     * Downward messages were processed using the given weight.
     */
    "DownwardMessagesProcessed": Anonymize<I100l07kaehdlp>;
    /**
     * An upward message was sent to the relay chain.
     */
    "UpwardMessageSent": Anonymize<I6gnbnvip5vvdi>;
}>;
export type Idd7hd99u0ho0n = {
    "relay_chain_block_num": number;
};
export type Iafscmv8tjf0ou = {
    "count": number;
};
export type I100l07kaehdlp = {
    "weight_used": Anonymize<I4q39t5hn830vp>;
    "dmq_head": FixedSizeBinary<32>;
};
export type I6gnbnvip5vvdi = {
    "message_hash"?: Anonymize<I4s6vifaf8k998>;
};
export type I4s6vifaf8k998 = (FixedSizeBinary<32>) | undefined;
export type Iaouq041baf2nh = AnonymousEnum<{
    /**
     * Batch of dispatches did not complete fully. Index of first failing dispatch given, as
     * well as the error.
     */
    "BatchInterrupted": Anonymize<I368e0tjmrcvlt>;
    /**
     * Batch of dispatches completed fully with no error.
     */
    "BatchCompleted": undefined;
    /**
     * Batch of dispatches completed but has errors.
     */
    "BatchCompletedWithErrors": undefined;
    /**
     * A single item within a Batch of dispatches has completed with no error.
     */
    "ItemCompleted": undefined;
    /**
     * A single item within a Batch of dispatches has completed with error.
     */
    "ItemFailed": Anonymize<I6akqkga7li13u>;
    /**
     * A call was dispatched.
     */
    "DispatchedAs": Anonymize<I133qpg6ru2jqi>;
    /**
     * Main call was dispatched.
     */
    "IfElseMainSuccess": undefined;
    /**
     * The fallback call was dispatched.
     */
    "IfElseFallbackCalled": Anonymize<I3bp93psani87u>;
}>;
export type I368e0tjmrcvlt = {
    "index": number;
    "error": Anonymize<Id3cclc8rha27v>;
};
export type I6akqkga7li13u = {
    "error": Anonymize<Id3cclc8rha27v>;
};
export type I133qpg6ru2jqi = {
    "result": Anonymize<I46bjfmr3l2gfb>;
};
export type I46bjfmr3l2gfb = ResultPayload<undefined, Anonymize<Id3cclc8rha27v>>;
export type I3bp93psani87u = {
    "main_error": Anonymize<Id3cclc8rha27v>;
};
export type Ifhlvt8s3bh824 = AnonymousEnum<{
    /**
     * An account was created with some free balance.
     */
    "Endowed": Anonymize<Icv68aq8841478>;
    /**
     * An account was removed whose balance was non-zero but below ExistentialDeposit,
     * resulting in an outright loss.
     */
    "DustLost": Anonymize<Ic262ibdoec56a>;
    /**
     * Transfer succeeded.
     */
    "Transfer": Anonymize<Iflcfm9b6nlmdd>;
    /**
     * A balance was set by root.
     */
    "BalanceSet": Anonymize<Ijrsf4mnp3eka>;
    /**
     * Some balance was reserved (moved from free to reserved).
     */
    "Reserved": Anonymize<Id5fm4p8lj5qgi>;
    /**
     * Some balance was unreserved (moved from reserved to free).
     */
    "Unreserved": Anonymize<Id5fm4p8lj5qgi>;
    /**
     * Some balance was moved from the reserve of the first account to the second account.
     * Final argument indicates the destination balance type.
     */
    "ReserveRepatriated": Anonymize<I8tjvj9uq4b7hi>;
    /**
     * Some amount was deposited (e.g. for transaction fees).
     */
    "Deposit": Anonymize<Id5fm4p8lj5qgi>;
    /**
     * Some amount was withdrawn from the account (e.g. for transaction fees).
     */
    "Withdraw": Anonymize<Id5fm4p8lj5qgi>;
    /**
     * Some amount was removed from the account (e.g. for misbehavior).
     */
    "Slashed": Anonymize<Id5fm4p8lj5qgi>;
    /**
     * Some amount was minted into an account.
     */
    "Minted": Anonymize<Id5fm4p8lj5qgi>;
    /**
     * Some credit was balanced and added to the TotalIssuance.
     */
    "MintedCredit": Anonymize<I3qt1hgg4djhgb>;
    /**
     * Some amount was burned from an account.
     */
    "Burned": Anonymize<Id5fm4p8lj5qgi>;
    /**
     * Some debt has been dropped from the Total Issuance.
     */
    "BurnedDebt": Anonymize<I3qt1hgg4djhgb>;
    /**
     * Some amount was suspended from an account (it can be restored later).
     */
    "Suspended": Anonymize<Id5fm4p8lj5qgi>;
    /**
     * Some amount was restored into an account.
     */
    "Restored": Anonymize<Id5fm4p8lj5qgi>;
    /**
     * An account was upgraded.
     */
    "Upgraded": Anonymize<I4cbvqmqadhrea>;
    /**
     * Total issuance was increased by `amount`, creating a credit to be balanced.
     */
    "Issued": Anonymize<I3qt1hgg4djhgb>;
    /**
     * Total issuance was decreased by `amount`, creating a debt to be balanced.
     */
    "Rescinded": Anonymize<I3qt1hgg4djhgb>;
    /**
     * Some balance was locked.
     */
    "Locked": Anonymize<Id5fm4p8lj5qgi>;
    /**
     * Some balance was unlocked.
     */
    "Unlocked": Anonymize<Id5fm4p8lj5qgi>;
    /**
     * Some balance was frozen.
     */
    "Frozen": Anonymize<Id5fm4p8lj5qgi>;
    /**
     * Some balance was thawed.
     */
    "Thawed": Anonymize<Id5fm4p8lj5qgi>;
    /**
     * The `TotalIssuance` was forcefully changed.
     */
    "TotalIssuanceForced": Anonymize<I4fooe9dun9o0t>;
    /**
     * Some balance was placed on hold.
     */
    "Held": Anonymize<I8mvf14goplnni>;
    /**
     * Held balance was burned from an account.
     */
    "BurnedHeld": Anonymize<I8mvf14goplnni>;
    /**
     * A transfer of `amount` on hold from `source` to `dest` was initiated.
     */
    "TransferOnHold": Anonymize<Ie09mpthond7d6>;
    /**
     * The `transferred` balance is placed on hold at the `dest` account.
     */
    "TransferAndHold": Anonymize<I1ispultrc7caq>;
    /**
     * Some balance was released from hold.
     */
    "Released": Anonymize<I8mvf14goplnni>;
    /**
     * An unexpected/defensive event was triggered.
     */
    "Unexpected": Anonymize<Iph9c4rn81ub2>;
}>;
export type Icv68aq8841478 = {
    "account": SS58String;
    "free_balance": bigint;
};
export type Ic262ibdoec56a = {
    "account": SS58String;
    "amount": bigint;
};
export type Iflcfm9b6nlmdd = {
    "from": SS58String;
    "to": SS58String;
    "amount": bigint;
};
export type Ijrsf4mnp3eka = {
    "who": SS58String;
    "free": bigint;
};
export type Id5fm4p8lj5qgi = {
    "who": SS58String;
    "amount": bigint;
};
export type I8tjvj9uq4b7hi = {
    "from": SS58String;
    "to": SS58String;
    "amount": bigint;
    "destination_status": BalanceStatus;
};
export type BalanceStatus = Enum<{
    "Free": undefined;
    "Reserved": undefined;
}>;
export declare const BalanceStatus: GetEnum<BalanceStatus>;
export type I3qt1hgg4djhgb = {
    "amount": bigint;
};
export type I4cbvqmqadhrea = {
    "who": SS58String;
};
export type I4fooe9dun9o0t = {
    "old": bigint;
    "new": bigint;
};
export type I8mvf14goplnni = {
    "reason": Anonymize<Ia44l7h6l7vcfa>;
    "who": SS58String;
    "amount": bigint;
};
export type Ia44l7h6l7vcfa = AnonymousEnum<{
    "TransactionStorage": Enum<{
        "StorageFeeHold": undefined;
    }>;
    "Session": Enum<{
        "Keys": undefined;
    }>;
    "PolkadotXcm": Enum<{
        "AuthorizeAlias": undefined;
    }>;
}>;
export type Ie09mpthond7d6 = {
    "reason": Anonymize<Ia44l7h6l7vcfa>;
    "source": SS58String;
    "dest": SS58String;
    "amount": bigint;
};
export type I1ispultrc7caq = {
    "reason": Anonymize<Ia44l7h6l7vcfa>;
    "source": SS58String;
    "dest": SS58String;
    "transferred": bigint;
};
export type Iph9c4rn81ub2 = AnonymousEnum<{
    "BalanceUpdated": undefined;
    "FailedToMutateAccount": undefined;
}>;
export type TransactionPaymentEvent = Enum<{
    /**
     * A transaction fee `actual_fee`, of which `tip` was added to the minimum inclusion fee,
     * has been paid by `who`.
     */
    "TransactionFeePaid": Anonymize<Ier2cke86dqbr2>;
}>;
export declare const TransactionPaymentEvent: GetEnum<TransactionPaymentEvent>;
export type Ier2cke86dqbr2 = {
    "who": SS58String;
    "actual_fee": bigint;
    "tip": bigint;
};
export type Idkntqrg9tr7h7 = AnonymousEnum<{
    /**
     * A transaction fee was skipped.
     */
    "FeeSkipped": Anonymize<I351cnlhk17436>;
}>;
export type I351cnlhk17436 = {
    "origin": Anonymize<I9g869l9vmunib>;
};
export type I9g869l9vmunib = AnonymousEnum<{
    "system": Enum<{
        "Root": undefined;
        "Signed": SS58String;
        "None": undefined;
        "Authorized": undefined;
    }>;
    "PolkadotXcm": Enum<{
        "Xcm": Anonymize<If9iqq7i64mur8>;
        "Response": Anonymize<If9iqq7i64mur8>;
    }>;
    "CumulusXcm": Enum<{
        "Relay": undefined;
        "SiblingParachain": number;
    }>;
}>;
export type If9iqq7i64mur8 = {
    "parents": number;
    "interior": XcmV5Junctions;
};
export type XcmV5Junctions = Enum<{
    "Here": undefined;
    "X1": XcmV5Junction;
    "X2": FixedSizeArray<2, XcmV5Junction>;
    "X3": FixedSizeArray<3, XcmV5Junction>;
    "X4": FixedSizeArray<4, XcmV5Junction>;
    "X5": FixedSizeArray<5, XcmV5Junction>;
    "X6": FixedSizeArray<6, XcmV5Junction>;
    "X7": FixedSizeArray<7, XcmV5Junction>;
    "X8": FixedSizeArray<8, XcmV5Junction>;
}>;
export declare const XcmV5Junctions: GetEnum<XcmV5Junctions>;
export type XcmV5Junction = Enum<{
    "Parachain": number;
    "AccountId32": {
        "network"?: Anonymize<I97pd2rst02a7r>;
        "id": FixedSizeBinary<32>;
    };
    "AccountIndex64": {
        "network"?: Anonymize<I97pd2rst02a7r>;
        "index": bigint;
    };
    "AccountKey20": {
        "network"?: Anonymize<I97pd2rst02a7r>;
        "key": FixedSizeBinary<20>;
    };
    "PalletInstance": number;
    "GeneralIndex": bigint;
    "GeneralKey": Anonymize<I15lht6t53odo4>;
    "OnlyChild": undefined;
    "Plurality": Anonymize<I518fbtnclg1oc>;
    "GlobalConsensus": XcmV5NetworkId;
}>;
export declare const XcmV5Junction: GetEnum<XcmV5Junction>;
export type I97pd2rst02a7r = (XcmV5NetworkId) | undefined;
export type XcmV5NetworkId = Enum<{
    "ByGenesis": FixedSizeBinary<32>;
    "ByFork": Anonymize<I15vf5oinmcgps>;
    "Polkadot": undefined;
    "Kusama": undefined;
    "Ethereum": Anonymize<I623eo8t3jrbeo>;
    "BitcoinCore": undefined;
    "BitcoinCash": undefined;
    "PolkadotBulletin": undefined;
}>;
export declare const XcmV5NetworkId: GetEnum<XcmV5NetworkId>;
export type I15vf5oinmcgps = {
    "block_number": bigint;
    "block_hash": FixedSizeBinary<32>;
};
export type I623eo8t3jrbeo = {
    "chain_id": bigint;
};
export type I15lht6t53odo4 = {
    "length": number;
    "data": FixedSizeBinary<32>;
};
export type I518fbtnclg1oc = {
    "id": XcmV3JunctionBodyId;
    "part": XcmV2JunctionBodyPart;
};
export type XcmV3JunctionBodyId = Enum<{
    "Unit": undefined;
    "Moniker": FixedSizeBinary<4>;
    "Index": number;
    "Executive": undefined;
    "Technical": undefined;
    "Legislative": undefined;
    "Judicial": undefined;
    "Defense": undefined;
    "Administration": undefined;
    "Treasury": undefined;
}>;
export declare const XcmV3JunctionBodyId: GetEnum<XcmV3JunctionBodyId>;
export type XcmV2JunctionBodyPart = Enum<{
    "Voice": undefined;
    "Members": Anonymize<Iafscmv8tjf0ou>;
    "Fraction": {
        "nom": number;
        "denom": number;
    };
    "AtLeastProportion": {
        "nom": number;
        "denom": number;
    };
    "MoreThanProportion": {
        "nom": number;
        "denom": number;
    };
}>;
export declare const XcmV2JunctionBodyPart: GetEnum<XcmV2JunctionBodyPart>;
export type I6a9k53vnitigf = AnonymousEnum<{
    /**
     * Stored data under specified index.
     */
    "Stored": Anonymize<I395h9meqpi2hf>;
    /**
     * Renewed data under specified index.
     */
    "Renewed": Anonymize<I66jdpl6lile9j>;
    /**
     * Storage proof was successfully checked.
     */
    "ProofChecked": undefined;
    /**
     * An account `who` was authorized to store `bytes` bytes in `transactions` transactions.
     */
    "AccountAuthorized": Anonymize<I2i8iea6e4ne1j>;
    /**
     * An authorization for account `who` was refreshed.
     */
    "AccountAuthorizationRefreshed": Anonymize<I4cbvqmqadhrea>;
    /**
     * Authorization was given for a preimage of `content_hash` (not exceeding `max_size`) to
     * be stored by anyone.
     */
    "PreimageAuthorized": Anonymize<I4jotama61aldv>;
    /**
     * An authorization for a preimage of `content_hash` was refreshed.
     */
    "PreimageAuthorizationRefreshed": Anonymize<I3rfugj0vt1ug5>;
    /**
     * An expired account authorization was removed.
     */
    "ExpiredAccountAuthorizationRemoved": Anonymize<I4cbvqmqadhrea>;
    /**
     * An expired preimage authorization was removed.
     */
    "ExpiredPreimageAuthorizationRemoved": Anonymize<I3rfugj0vt1ug5>;
}>;
export type I395h9meqpi2hf = {
    "index": number;
    "content_hash": FixedSizeBinary<32>;
    "cid"?: Anonymize<Iabpgqcjikia83>;
};
export type Iabpgqcjikia83 = (Binary) | undefined;
export type I66jdpl6lile9j = {
    "index": number;
    "content_hash": FixedSizeBinary<32>;
};
export type I2i8iea6e4ne1j = {
    "who": SS58String;
    "transactions": number;
    "bytes": bigint;
};
export type I4jotama61aldv = {
    "content_hash": FixedSizeBinary<32>;
    "max_size": bigint;
};
export type I3rfugj0vt1ug5 = {
    "content_hash": FixedSizeBinary<32>;
};
export type I4srakrmf0fspo = AnonymousEnum<{
    /**
     * New Invulnerables were set.
     */
    "NewInvulnerables": Anonymize<I39t01nnod9109>;
    /**
     * A new Invulnerable was added.
     */
    "InvulnerableAdded": Anonymize<I6v8sm60vvkmk7>;
    /**
     * An Invulnerable was removed.
     */
    "InvulnerableRemoved": Anonymize<I6v8sm60vvkmk7>;
    /**
     * The number of desired candidates was set.
     */
    "NewDesiredCandidates": Anonymize<I1qmtmbe5so8r3>;
    /**
     * The candidacy bond was set.
     */
    "NewCandidacyBond": Anonymize<Ih99m6ehpcar7>;
    /**
     * A new candidate joined.
     */
    "CandidateAdded": Anonymize<Idgorhsbgdq2ap>;
    /**
     * Bond of a candidate updated.
     */
    "CandidateBondUpdated": Anonymize<Idgorhsbgdq2ap>;
    /**
     * A candidate was removed.
     */
    "CandidateRemoved": Anonymize<I6v8sm60vvkmk7>;
    /**
     * An account was replaced in the candidate list by another one.
     */
    "CandidateReplaced": Anonymize<I9ubb2kqevnu6t>;
    /**
     * An account was unable to be added to the Invulnerables because they did not have keys
     * registered. Other Invulnerables may have been set.
     */
    "InvalidInvulnerableSkipped": Anonymize<I6v8sm60vvkmk7>;
}>;
export type I39t01nnod9109 = {
    "invulnerables": Anonymize<Ia2lhg7l2hilo3>;
};
export type Ia2lhg7l2hilo3 = Array<SS58String>;
export type I6v8sm60vvkmk7 = {
    "account_id": SS58String;
};
export type I1qmtmbe5so8r3 = {
    "desired_candidates": number;
};
export type Ih99m6ehpcar7 = {
    "bond_amount": bigint;
};
export type Idgorhsbgdq2ap = {
    "account_id": SS58String;
    "deposit": bigint;
};
export type I9ubb2kqevnu6t = {
    "old": SS58String;
    "new": SS58String;
    "deposit": bigint;
};
export type I6ue0ck5fc3u44 = AnonymousEnum<{
    /**
     * New session has happened. Note that the argument is the session index, not the
     * block number as the type might suggest.
     */
    "NewSession": Anonymize<I2hq50pu2kdjpo>;
    /**
     * The `NewSession` event in the current block also implies a new validator set to be
     * queued.
     */
    "NewQueued": undefined;
    /**
     * Validator has been disabled.
     */
    "ValidatorDisabled": Anonymize<I9acqruh7322g2>;
    /**
     * Validator has been re-enabled.
     */
    "ValidatorReenabled": Anonymize<I9acqruh7322g2>;
}>;
export type I2hq50pu2kdjpo = {
    "session_index": number;
};
export type I9acqruh7322g2 = {
    "validator": SS58String;
};
export type Idsqc7mhp6nnle = AnonymousEnum<{
    /**
     * An HRMP message was sent to a sibling parachain.
     */
    "XcmpMessageSent": Anonymize<I137t1cld92pod>;
}>;
export type I137t1cld92pod = {
    "message_hash": FixedSizeBinary<32>;
};
export type If95hivmqmkiku = AnonymousEnum<{
    /**
     * Execution of an XCM message was attempted.
     */
    "Attempted": Anonymize<I61d51nv4cou88>;
    /**
     * An XCM message was sent.
     */
    "Sent": Anonymize<If8u5kl4h8070m>;
    /**
     * An XCM message failed to send.
     */
    "SendFailed": Anonymize<Ibmuil6p3vl83l>;
    /**
     * An XCM message failed to process.
     */
    "ProcessXcmError": Anonymize<I7lul91g50ae87>;
    /**
     * Query response received which does not match a registered query. This may be because a
     * matching query was never registered, it may be because it is a duplicate response, or
     * because the query timed out.
     */
    "UnexpectedResponse": Anonymize<Icl7nl1rfeog3i>;
    /**
     * Query response has been received and is ready for taking with `take_response`. There is
     * no registered notification call.
     */
    "ResponseReady": Anonymize<Iasr6pj6shs0fl>;
    /**
     * Query response has been received and query is removed. The registered notification has
     * been dispatched and executed successfully.
     */
    "Notified": Anonymize<I2uqmls7kcdnii>;
    /**
     * Query response has been received and query is removed. The registered notification
     * could not be dispatched because the dispatch weight is greater than the maximum weight
     * originally budgeted by this runtime for the query result.
     */
    "NotifyOverweight": Anonymize<Idg69klialbkb8>;
    /**
     * Query response has been received and query is removed. There was a general error with
     * dispatching the notification call.
     */
    "NotifyDispatchError": Anonymize<I2uqmls7kcdnii>;
    /**
     * Query response has been received and query is removed. The dispatch was unable to be
     * decoded into a `Call`; this might be due to dispatch function having a signature which
     * is not `(origin, QueryId, Response)`.
     */
    "NotifyDecodeFailed": Anonymize<I2uqmls7kcdnii>;
    /**
     * Expected query response has been received but the origin location of the response does
     * not match that expected. The query remains registered for a later, valid, response to
     * be received and acted upon.
     */
    "InvalidResponder": Anonymize<I7r6b7145022pp>;
    /**
     * Expected query response has been received but the expected origin location placed in
     * storage by this runtime previously cannot be decoded. The query remains registered.
     *
     * This is unexpected (since a location placed in storage in a previously executing
     * runtime should be readable prior to query timeout) and dangerous since the possibly
     * valid response will be dropped. Manual governance intervention is probably going to be
     * needed.
     */
    "InvalidResponderVersion": Anonymize<Icl7nl1rfeog3i>;
    /**
     * Received query response has been read and removed.
     */
    "ResponseTaken": Anonymize<I30pg328m00nr3>;
    /**
     * Some assets have been placed in an asset trap.
     */
    "AssetsTrapped": Anonymize<Icmrn7bogp28cs>;
    /**
     * An XCM version change notification message has been attempted to be sent.
     *
     * The cost of sending it (borne by the chain) is included.
     */
    "VersionChangeNotified": Anonymize<I7m9b5plj4h5ot>;
    /**
     * The supported version of a location has been changed. This might be through an
     * automatic notification or a manual intervention.
     */
    "SupportedVersionChanged": Anonymize<I9kt8c221c83ln>;
    /**
     * A given location which had a version change subscription was dropped owing to an error
     * sending the notification to it.
     */
    "NotifyTargetSendFail": Anonymize<I9onhk772nfs4f>;
    /**
     * A given location which had a version change subscription was dropped owing to an error
     * migrating the location to our new XCM format.
     */
    "NotifyTargetMigrationFail": Anonymize<I3l6bnksrmt56r>;
    /**
     * Expected query response has been received but the expected querier location placed in
     * storage by this runtime previously cannot be decoded. The query remains registered.
     *
     * This is unexpected (since a location placed in storage in a previously executing
     * runtime should be readable prior to query timeout) and dangerous since the possibly
     * valid response will be dropped. Manual governance intervention is probably going to be
     * needed.
     */
    "InvalidQuerierVersion": Anonymize<Icl7nl1rfeog3i>;
    /**
     * Expected query response has been received but the querier location of the response does
     * not match the expected. The query remains registered for a later, valid, response to
     * be received and acted upon.
     */
    "InvalidQuerier": Anonymize<Idh09k0l2pmdcg>;
    /**
     * A remote has requested XCM version change notification from us and we have honored it.
     * A version information message is sent to them and its cost is included.
     */
    "VersionNotifyStarted": Anonymize<I7uoiphbm0tj4r>;
    /**
     * We have requested that a remote chain send us XCM version change notifications.
     */
    "VersionNotifyRequested": Anonymize<I7uoiphbm0tj4r>;
    /**
     * We have requested that a remote chain stops sending us XCM version change
     * notifications.
     */
    "VersionNotifyUnrequested": Anonymize<I7uoiphbm0tj4r>;
    /**
     * Fees were paid from a location for an operation (often for using `SendXcm`).
     */
    "FeesPaid": Anonymize<I512p1n7qt24l8>;
    /**
     * Some assets have been claimed from an asset trap
     */
    "AssetsClaimed": Anonymize<Icmrn7bogp28cs>;
    /**
     * A XCM version migration finished.
     */
    "VersionMigrationFinished": Anonymize<I6s1nbislhk619>;
    /**
     * An `aliaser` location was authorized by `target` to alias it, authorization valid until
     * `expiry` block number.
     */
    "AliasAuthorized": Anonymize<I3gghqnh2mj0is>;
    /**
     * `target` removed alias authorization for `aliaser`.
     */
    "AliasAuthorizationRemoved": Anonymize<I6iv852roh6t3h>;
    /**
     * `target` removed all alias authorizations.
     */
    "AliasesAuthorizationsRemoved": Anonymize<I9oc2o6itbiopq>;
}>;
export type I61d51nv4cou88 = {
    "outcome": Anonymize<Ieqhmksji3pmv5>;
};
export type Ieqhmksji3pmv5 = AnonymousEnum<{
    "Complete": {
        "used": Anonymize<I4q39t5hn830vp>;
    };
    "Incomplete": {
        "used": Anonymize<I4q39t5hn830vp>;
        "error": Anonymize<Ieiju48dn66cuh>;
    };
    "Error": Anonymize<Ieiju48dn66cuh>;
}>;
export type Ieiju48dn66cuh = {
    "index": number;
    "error": Anonymize<Id56rgs0bdb7gl>;
};
export type Id56rgs0bdb7gl = AnonymousEnum<{
    "Overflow": undefined;
    "Unimplemented": undefined;
    "UntrustedReserveLocation": undefined;
    "UntrustedTeleportLocation": undefined;
    "LocationFull": undefined;
    "LocationNotInvertible": undefined;
    "BadOrigin": undefined;
    "InvalidLocation": undefined;
    "AssetNotFound": undefined;
    "FailedToTransactAsset": undefined;
    "NotWithdrawable": undefined;
    "LocationCannotHold": undefined;
    "ExceedsMaxMessageSize": undefined;
    "DestinationUnsupported": undefined;
    "Transport": undefined;
    "Unroutable": undefined;
    "UnknownClaim": undefined;
    "FailedToDecode": undefined;
    "MaxWeightInvalid": undefined;
    "NotHoldingFees": undefined;
    "TooExpensive": undefined;
    "Trap": bigint;
    "ExpectationFalse": undefined;
    "PalletNotFound": undefined;
    "NameMismatch": undefined;
    "VersionIncompatible": undefined;
    "HoldingWouldOverflow": undefined;
    "ExportError": undefined;
    "ReanchorFailed": undefined;
    "NoDeal": undefined;
    "FeesNotMet": undefined;
    "LockError": undefined;
    "NoPermission": undefined;
    "Unanchored": undefined;
    "NotDepositable": undefined;
    "TooManyAssets": undefined;
    "UnhandledXcmVersion": undefined;
    "WeightLimitReached": Anonymize<I4q39t5hn830vp>;
    "Barrier": undefined;
    "WeightNotComputable": undefined;
    "ExceedsStackLimit": undefined;
}>;
export type If8u5kl4h8070m = {
    "origin": Anonymize<If9iqq7i64mur8>;
    "destination": Anonymize<If9iqq7i64mur8>;
    "message": Anonymize<Ict03eedr8de9s>;
    "message_id": FixedSizeBinary<32>;
};
export type Ict03eedr8de9s = Array<XcmV5Instruction>;
export type XcmV5Instruction = Enum<{
    "WithdrawAsset": Anonymize<I4npjalvhmfuj>;
    "ReserveAssetDeposited": Anonymize<I4npjalvhmfuj>;
    "ReceiveTeleportedAsset": Anonymize<I4npjalvhmfuj>;
    "QueryResponse": {
        "query_id": bigint;
        "response": Anonymize<I7vucpgm2c6959>;
        "max_weight": Anonymize<I4q39t5hn830vp>;
        "querier"?: Anonymize<I4pai6qnfk426l>;
    };
    "TransferAsset": {
        "assets": Anonymize<I4npjalvhmfuj>;
        "beneficiary": Anonymize<If9iqq7i64mur8>;
    };
    "TransferReserveAsset": {
        "assets": Anonymize<I4npjalvhmfuj>;
        "dest": Anonymize<If9iqq7i64mur8>;
        "xcm": Anonymize<Ict03eedr8de9s>;
    };
    "Transact": {
        "origin_kind": XcmV2OriginKind;
        "fallback_max_weight"?: Anonymize<Iasb8k6ash5mjn>;
        "call": Binary;
    };
    "HrmpNewChannelOpenRequest": Anonymize<I5uhhrjqfuo4e5>;
    "HrmpChannelAccepted": Anonymize<Ifij4jam0o7sub>;
    "HrmpChannelClosing": Anonymize<Ieeb4svd9i8fji>;
    "ClearOrigin": undefined;
    "DescendOrigin": XcmV5Junctions;
    "ReportError": Anonymize<I6vsmh07hrp1rc>;
    "DepositAsset": {
        "assets": XcmV5AssetFilter;
        "beneficiary": Anonymize<If9iqq7i64mur8>;
    };
    "DepositReserveAsset": {
        "assets": XcmV5AssetFilter;
        "dest": Anonymize<If9iqq7i64mur8>;
        "xcm": Anonymize<Ict03eedr8de9s>;
    };
    "ExchangeAsset": {
        "give": XcmV5AssetFilter;
        "want": Anonymize<I4npjalvhmfuj>;
        "maximal": boolean;
    };
    "InitiateReserveWithdraw": {
        "assets": XcmV5AssetFilter;
        "reserve": Anonymize<If9iqq7i64mur8>;
        "xcm": Anonymize<Ict03eedr8de9s>;
    };
    "InitiateTeleport": {
        "assets": XcmV5AssetFilter;
        "dest": Anonymize<If9iqq7i64mur8>;
        "xcm": Anonymize<Ict03eedr8de9s>;
    };
    "ReportHolding": {
        "response_info": Anonymize<I6vsmh07hrp1rc>;
        "assets": XcmV5AssetFilter;
    };
    "BuyExecution": {
        "fees": Anonymize<Iffh1nc5e1mod6>;
        "weight_limit": XcmV3WeightLimit;
    };
    "RefundSurplus": undefined;
    "SetErrorHandler": Anonymize<Ict03eedr8de9s>;
    "SetAppendix": Anonymize<Ict03eedr8de9s>;
    "ClearError": undefined;
    "ClaimAsset": {
        "assets": Anonymize<I4npjalvhmfuj>;
        "ticket": Anonymize<If9iqq7i64mur8>;
    };
    "Trap": bigint;
    "SubscribeVersion": Anonymize<Ieprdqqu7ildvr>;
    "UnsubscribeVersion": undefined;
    "BurnAsset": Anonymize<I4npjalvhmfuj>;
    "ExpectAsset": Anonymize<I4npjalvhmfuj>;
    "ExpectOrigin"?: Anonymize<I4pai6qnfk426l>;
    "ExpectError"?: Anonymize<I3l6ejee750fv1>;
    "ExpectTransactStatus": XcmV3MaybeErrorCode;
    "QueryPallet": {
        "module_name": Binary;
        "response_info": Anonymize<I6vsmh07hrp1rc>;
    };
    "ExpectPallet": Anonymize<Id7mf37dkpgfjs>;
    "ReportTransactStatus": Anonymize<I6vsmh07hrp1rc>;
    "ClearTransactStatus": undefined;
    "UniversalOrigin": XcmV5Junction;
    "ExportMessage": {
        "network": XcmV5NetworkId;
        "destination": XcmV5Junctions;
        "xcm": Anonymize<Ict03eedr8de9s>;
    };
    "LockAsset": {
        "asset": Anonymize<Iffh1nc5e1mod6>;
        "unlocker": Anonymize<If9iqq7i64mur8>;
    };
    "UnlockAsset": {
        "asset": Anonymize<Iffh1nc5e1mod6>;
        "target": Anonymize<If9iqq7i64mur8>;
    };
    "NoteUnlockable": {
        "asset": Anonymize<Iffh1nc5e1mod6>;
        "owner": Anonymize<If9iqq7i64mur8>;
    };
    "RequestUnlock": {
        "asset": Anonymize<Iffh1nc5e1mod6>;
        "locker": Anonymize<If9iqq7i64mur8>;
    };
    "SetFeesMode": Anonymize<I4nae9rsql8fa7>;
    "SetTopic": FixedSizeBinary<32>;
    "ClearTopic": undefined;
    "AliasOrigin": Anonymize<If9iqq7i64mur8>;
    "UnpaidExecution": {
        "weight_limit": XcmV3WeightLimit;
        "check_origin"?: Anonymize<I4pai6qnfk426l>;
    };
    "PayFees": {
        "asset": Anonymize<Iffh1nc5e1mod6>;
    };
    "InitiateTransfer": {
        "destination": Anonymize<If9iqq7i64mur8>;
        "remote_fees"?: (Anonymize<Ifhmc9e7vpeeig>) | undefined;
        "preserve_origin": boolean;
        "assets": Array<Anonymize<Ifhmc9e7vpeeig>>;
        "remote_xcm": Anonymize<Ict03eedr8de9s>;
    };
    "ExecuteWithOrigin": {
        "descendant_origin"?: (XcmV5Junctions) | undefined;
        "xcm": Anonymize<Ict03eedr8de9s>;
    };
    "SetHints": {
        "hints": Array<Enum<{
            "AssetClaimer": {
                "location": Anonymize<If9iqq7i64mur8>;
            };
        }>>;
    };
}>;
export declare const XcmV5Instruction: GetEnum<XcmV5Instruction>;
export type I4npjalvhmfuj = Array<Anonymize<Iffh1nc5e1mod6>>;
export type Iffh1nc5e1mod6 = {
    "id": Anonymize<If9iqq7i64mur8>;
    "fun": XcmV3MultiassetFungibility;
};
export type XcmV3MultiassetFungibility = Enum<{
    "Fungible": bigint;
    "NonFungible": XcmV3MultiassetAssetInstance;
}>;
export declare const XcmV3MultiassetFungibility: GetEnum<XcmV3MultiassetFungibility>;
export type XcmV3MultiassetAssetInstance = Enum<{
    "Undefined": undefined;
    "Index": bigint;
    "Array4": FixedSizeBinary<4>;
    "Array8": FixedSizeBinary<8>;
    "Array16": FixedSizeBinary<16>;
    "Array32": FixedSizeBinary<32>;
}>;
export declare const XcmV3MultiassetAssetInstance: GetEnum<XcmV3MultiassetAssetInstance>;
export type I7vucpgm2c6959 = AnonymousEnum<{
    "Null": undefined;
    "Assets": Anonymize<I4npjalvhmfuj>;
    "ExecutionResult"?: Anonymize<I3l6ejee750fv1>;
    "Version": number;
    "PalletsInfo": Anonymize<I599u7h20b52at>;
    "DispatchResult": XcmV3MaybeErrorCode;
}>;
export type I3l6ejee750fv1 = ([number, Anonymize<Id56rgs0bdb7gl>]) | undefined;
export type I599u7h20b52at = Array<{
    "index": number;
    "name": Binary;
    "module_name": Binary;
    "major": number;
    "minor": number;
    "patch": number;
}>;
export type XcmV3MaybeErrorCode = Enum<{
    "Success": undefined;
    "Error": Binary;
    "TruncatedError": Binary;
}>;
export declare const XcmV3MaybeErrorCode: GetEnum<XcmV3MaybeErrorCode>;
export type I4pai6qnfk426l = (Anonymize<If9iqq7i64mur8>) | undefined;
export type XcmV2OriginKind = Enum<{
    "Native": undefined;
    "SovereignAccount": undefined;
    "Superuser": undefined;
    "Xcm": undefined;
}>;
export declare const XcmV2OriginKind: GetEnum<XcmV2OriginKind>;
export type Iasb8k6ash5mjn = (Anonymize<I4q39t5hn830vp>) | undefined;
export type I5uhhrjqfuo4e5 = {
    "sender": number;
    "max_message_size": number;
    "max_capacity": number;
};
export type Ifij4jam0o7sub = {
    "recipient": number;
};
export type Ieeb4svd9i8fji = {
    "initiator": number;
    "sender": number;
    "recipient": number;
};
export type I6vsmh07hrp1rc = {
    "destination": Anonymize<If9iqq7i64mur8>;
    "query_id": bigint;
    "max_weight": Anonymize<I4q39t5hn830vp>;
};
export type XcmV5AssetFilter = Enum<{
    "Definite": Anonymize<I4npjalvhmfuj>;
    "Wild": XcmV5WildAsset;
}>;
export declare const XcmV5AssetFilter: GetEnum<XcmV5AssetFilter>;
export type XcmV5WildAsset = Enum<{
    "All": undefined;
    "AllOf": {
        "id": Anonymize<If9iqq7i64mur8>;
        "fun": XcmV2MultiassetWildFungibility;
    };
    "AllCounted": number;
    "AllOfCounted": {
        "id": Anonymize<If9iqq7i64mur8>;
        "fun": XcmV2MultiassetWildFungibility;
        "count": number;
    };
}>;
export declare const XcmV5WildAsset: GetEnum<XcmV5WildAsset>;
export type XcmV2MultiassetWildFungibility = Enum<{
    "Fungible": undefined;
    "NonFungible": undefined;
}>;
export declare const XcmV2MultiassetWildFungibility: GetEnum<XcmV2MultiassetWildFungibility>;
export type XcmV3WeightLimit = Enum<{
    "Unlimited": undefined;
    "Limited": Anonymize<I4q39t5hn830vp>;
}>;
export declare const XcmV3WeightLimit: GetEnum<XcmV3WeightLimit>;
export type Ieprdqqu7ildvr = {
    "query_id": bigint;
    "max_response_weight": Anonymize<I4q39t5hn830vp>;
};
export type Id7mf37dkpgfjs = {
    "index": number;
    "name": Binary;
    "module_name": Binary;
    "crate_major": number;
    "min_crate_minor": number;
};
export type I4nae9rsql8fa7 = {
    "jit_withdraw": boolean;
};
export type Ifhmc9e7vpeeig = AnonymousEnum<{
    "Teleport": XcmV5AssetFilter;
    "ReserveDeposit": XcmV5AssetFilter;
    "ReserveWithdraw": XcmV5AssetFilter;
}>;
export type Ibmuil6p3vl83l = {
    "origin": Anonymize<If9iqq7i64mur8>;
    "destination": Anonymize<If9iqq7i64mur8>;
    "error": Enum<{
        "NotApplicable": undefined;
        "Transport": undefined;
        "Unroutable": undefined;
        "DestinationUnsupported": undefined;
        "ExceedsMaxMessageSize": undefined;
        "MissingArgument": undefined;
        "Fees": undefined;
    }>;
    "message_id": FixedSizeBinary<32>;
};
export type I7lul91g50ae87 = {
    "origin": Anonymize<If9iqq7i64mur8>;
    "error": Anonymize<Id56rgs0bdb7gl>;
    "message_id": FixedSizeBinary<32>;
};
export type Icl7nl1rfeog3i = {
    "origin": Anonymize<If9iqq7i64mur8>;
    "query_id": bigint;
};
export type Iasr6pj6shs0fl = {
    "query_id": bigint;
    "response": Anonymize<I7vucpgm2c6959>;
};
export type I2uqmls7kcdnii = {
    "query_id": bigint;
    "pallet_index": number;
    "call_index": number;
};
export type Idg69klialbkb8 = {
    "query_id": bigint;
    "pallet_index": number;
    "call_index": number;
    "actual_weight": Anonymize<I4q39t5hn830vp>;
    "max_budgeted_weight": Anonymize<I4q39t5hn830vp>;
};
export type I7r6b7145022pp = {
    "origin": Anonymize<If9iqq7i64mur8>;
    "query_id": bigint;
    "expected_location"?: Anonymize<I4pai6qnfk426l>;
};
export type I30pg328m00nr3 = {
    "query_id": bigint;
};
export type Icmrn7bogp28cs = {
    "hash": FixedSizeBinary<32>;
    "origin": Anonymize<If9iqq7i64mur8>;
    "assets": XcmVersionedAssets;
};
export type XcmVersionedAssets = Enum<{
    "V3": Anonymize<Iai6dhqiq3bach>;
    "V4": Anonymize<I50mli3hb64f9b>;
    "V5": Anonymize<I4npjalvhmfuj>;
}>;
export declare const XcmVersionedAssets: GetEnum<XcmVersionedAssets>;
export type Iai6dhqiq3bach = Array<Anonymize<Idcm24504c8bkk>>;
export type Idcm24504c8bkk = {
    "id": XcmV3MultiassetAssetId;
    "fun": XcmV3MultiassetFungibility;
};
export type XcmV3MultiassetAssetId = Enum<{
    "Concrete": Anonymize<I4c0s5cioidn76>;
    "Abstract": FixedSizeBinary<32>;
}>;
export declare const XcmV3MultiassetAssetId: GetEnum<XcmV3MultiassetAssetId>;
export type I4c0s5cioidn76 = {
    "parents": number;
    "interior": XcmV3Junctions;
};
export type XcmV3Junctions = Enum<{
    "Here": undefined;
    "X1": XcmV3Junction;
    "X2": FixedSizeArray<2, XcmV3Junction>;
    "X3": FixedSizeArray<3, XcmV3Junction>;
    "X4": FixedSizeArray<4, XcmV3Junction>;
    "X5": FixedSizeArray<5, XcmV3Junction>;
    "X6": FixedSizeArray<6, XcmV3Junction>;
    "X7": FixedSizeArray<7, XcmV3Junction>;
    "X8": FixedSizeArray<8, XcmV3Junction>;
}>;
export declare const XcmV3Junctions: GetEnum<XcmV3Junctions>;
export type XcmV3Junction = Enum<{
    "Parachain": number;
    "AccountId32": {
        "network"?: Anonymize<Idcq3vns9tgp5p>;
        "id": FixedSizeBinary<32>;
    };
    "AccountIndex64": {
        "network"?: Anonymize<Idcq3vns9tgp5p>;
        "index": bigint;
    };
    "AccountKey20": {
        "network"?: Anonymize<Idcq3vns9tgp5p>;
        "key": FixedSizeBinary<20>;
    };
    "PalletInstance": number;
    "GeneralIndex": bigint;
    "GeneralKey": Anonymize<I15lht6t53odo4>;
    "OnlyChild": undefined;
    "Plurality": Anonymize<I518fbtnclg1oc>;
    "GlobalConsensus": XcmV3JunctionNetworkId;
}>;
export declare const XcmV3Junction: GetEnum<XcmV3Junction>;
export type Idcq3vns9tgp5p = (XcmV3JunctionNetworkId) | undefined;
export type XcmV3JunctionNetworkId = Enum<{
    "ByGenesis": FixedSizeBinary<32>;
    "ByFork": Anonymize<I15vf5oinmcgps>;
    "Polkadot": undefined;
    "Kusama": undefined;
    "Westend": undefined;
    "Rococo": undefined;
    "Wococo": undefined;
    "Ethereum": Anonymize<I623eo8t3jrbeo>;
    "BitcoinCore": undefined;
    "BitcoinCash": undefined;
    "PolkadotBulletin": undefined;
}>;
export declare const XcmV3JunctionNetworkId: GetEnum<XcmV3JunctionNetworkId>;
export type I50mli3hb64f9b = Array<Anonymize<Ia5l7mu5a6v49o>>;
export type Ia5l7mu5a6v49o = {
    "id": Anonymize<I4c0s5cioidn76>;
    "fun": XcmV3MultiassetFungibility;
};
export type I7m9b5plj4h5ot = {
    "destination": Anonymize<If9iqq7i64mur8>;
    "result": number;
    "cost": Anonymize<I4npjalvhmfuj>;
    "message_id": FixedSizeBinary<32>;
};
export type I9kt8c221c83ln = {
    "location": Anonymize<If9iqq7i64mur8>;
    "version": number;
};
export type I9onhk772nfs4f = {
    "location": Anonymize<If9iqq7i64mur8>;
    "query_id": bigint;
    "error": Anonymize<Id56rgs0bdb7gl>;
};
export type I3l6bnksrmt56r = {
    "location": XcmVersionedLocation;
    "query_id": bigint;
};
export type XcmVersionedLocation = Enum<{
    "V3": Anonymize<I4c0s5cioidn76>;
    "V4": Anonymize<I4c0s5cioidn76>;
    "V5": Anonymize<If9iqq7i64mur8>;
}>;
export declare const XcmVersionedLocation: GetEnum<XcmVersionedLocation>;
export type Idh09k0l2pmdcg = {
    "origin": Anonymize<If9iqq7i64mur8>;
    "query_id": bigint;
    "expected_querier": Anonymize<If9iqq7i64mur8>;
    "maybe_actual_querier"?: Anonymize<I4pai6qnfk426l>;
};
export type I7uoiphbm0tj4r = {
    "destination": Anonymize<If9iqq7i64mur8>;
    "cost": Anonymize<I4npjalvhmfuj>;
    "message_id": FixedSizeBinary<32>;
};
export type I512p1n7qt24l8 = {
    "paying": Anonymize<If9iqq7i64mur8>;
    "fees": Anonymize<I4npjalvhmfuj>;
};
export type I6s1nbislhk619 = {
    "version": number;
};
export type I3gghqnh2mj0is = {
    "aliaser": Anonymize<If9iqq7i64mur8>;
    "target": Anonymize<If9iqq7i64mur8>;
    "expiry"?: Anonymize<I35p85j063s0il>;
};
export type I35p85j063s0il = (bigint) | undefined;
export type I6iv852roh6t3h = {
    "aliaser": Anonymize<If9iqq7i64mur8>;
    "target": Anonymize<If9iqq7i64mur8>;
};
export type I9oc2o6itbiopq = {
    "target": Anonymize<If9iqq7i64mur8>;
};
export type I5uv57c3fffoi9 = AnonymousEnum<{
    /**
     * Downward message is invalid XCM.
     * \[ id \]
     */
    "InvalidFormat": FixedSizeBinary<32>;
    /**
     * Downward message is unsupported version of XCM.
     * \[ id \]
     */
    "UnsupportedVersion": FixedSizeBinary<32>;
    /**
     * Downward message executed with the given outcome.
     * \[ id, outcome \]
     */
    "ExecutedDownward": Anonymize<Ibslgga81p36aa>;
}>;
export type Ibslgga81p36aa = [FixedSizeBinary<32>, Anonymize<Ieqhmksji3pmv5>];
export type I2kosejppk3jon = AnonymousEnum<{
    /**
     * Message discarded due to an error in the `MessageProcessor` (usually a format error).
     */
    "ProcessingFailed": Anonymize<I1rvj4ubaplho0>;
    /**
     * Message is processed.
     */
    "Processed": Anonymize<Ia3uu7lqcc1q1i>;
    /**
     * Message placed in overweight queue.
     */
    "OverweightEnqueued": Anonymize<I7crucfnonitkn>;
    /**
     * This page was reaped.
     */
    "PageReaped": Anonymize<I7tmrp94r9sq4n>;
}>;
export type I1rvj4ubaplho0 = {
    /**
     * The `blake2_256` hash of the message.
     */
    "id": FixedSizeBinary<32>;
    /**
     * The queue of the message.
     */
    "origin": Anonymize<Iejeo53sea6n4q>;
    /**
     * The error that occurred.
     *
     * This error is pretty opaque. More fine-grained errors need to be emitted as events
     * by the `MessageProcessor`.
     */
    "error": Enum<{
        "BadFormat": undefined;
        "Corrupt": undefined;
        "Unsupported": undefined;
        "Overweight": Anonymize<I4q39t5hn830vp>;
        "Yield": undefined;
        "StackLimitReached": undefined;
    }>;
};
export type Iejeo53sea6n4q = AnonymousEnum<{
    "Here": undefined;
    "Parent": undefined;
    "Sibling": number;
}>;
export type Ia3uu7lqcc1q1i = {
    /**
     * The `blake2_256` hash of the message.
     */
    "id": FixedSizeBinary<32>;
    /**
     * The queue of the message.
     */
    "origin": Anonymize<Iejeo53sea6n4q>;
    /**
     * How much weight was used to process the message.
     */
    "weight_used": Anonymize<I4q39t5hn830vp>;
    /**
     * Whether the message was processed.
     *
     * Note that this does not mean that the underlying `MessageProcessor` was internally
     * successful. It *solely* means that the MQ pallet will treat this as a success
     * condition and discard the message. Any internal error needs to be emitted as events
     * by the `MessageProcessor`.
     */
    "success": boolean;
};
export type I7crucfnonitkn = {
    /**
     * The `blake2_256` hash of the message.
     */
    "id": FixedSizeBinary<32>;
    /**
     * The queue of the message.
     */
    "origin": Anonymize<Iejeo53sea6n4q>;
    /**
     * The page of the message.
     */
    "page_index": number;
    /**
     * The index of the message within the page.
     */
    "message_index": number;
};
export type I7tmrp94r9sq4n = {
    /**
     * The queue of the page.
     */
    "origin": Anonymize<Iejeo53sea6n4q>;
    /**
     * The index of the page.
     */
    "index": number;
};
export type I4mr5fuq4vs8tb = AnonymousEnum<{
    /**
     * A sudo call just took place.
     */
    "Sudid": Anonymize<I4kigljjkan2n6>;
    /**
     * The sudo key has been updated.
     */
    "KeyChanged": Anonymize<I5rtkmhm2dng4u>;
    /**
     * The key was permanently removed.
     */
    "KeyRemoved": undefined;
    /**
     * A [sudo_as](Pallet::sudo_as) call just took place.
     */
    "SudoAsDone": Anonymize<I4kigljjkan2n6>;
}>;
export type I4kigljjkan2n6 = {
    /**
     * The result of the call made by the sudo user.
     */
    "sudo_result": Anonymize<I46bjfmr3l2gfb>;
};
export type I5rtkmhm2dng4u = {
    /**
     * The old sudo key (if one was previously set).
     */
    "old"?: (SS58String) | undefined;
    /**
     * The new sudo key (if one was set).
     */
    "new": SS58String;
};
export type Ic5m5lp1oioo8r = Array<FixedSizeBinary<32>>;
export type I95g6i7ilua7lq = Array<FixedSizeArray<2, number>>;
export type Ieniouoqkq4icf = {
    "spec_version": number;
    "spec_name": string;
};
export type I1v7jbnil3tjns = Array<{
    "used_bandwidth": Anonymize<Ieafp1gui1o4cl>;
    "para_head_hash"?: Anonymize<I4s6vifaf8k998>;
    "consumed_go_ahead_signal"?: Anonymize<Iav8k1edbj86k7>;
}>;
export type Ieafp1gui1o4cl = {
    "ump_msg_count": number;
    "ump_total_bytes": number;
    "hrmp_outgoing": Array<[number, {
        "msg_count": number;
        "total_bytes": number;
    }]>;
};
export type Iav8k1edbj86k7 = (UpgradeGoAhead) | undefined;
export type UpgradeGoAhead = Enum<{
    "Abort": undefined;
    "GoAhead": undefined;
}>;
export declare const UpgradeGoAhead: GetEnum<UpgradeGoAhead>;
export type I8jgj1nhcr2dg8 = {
    "used_bandwidth": Anonymize<Ieafp1gui1o4cl>;
    "hrmp_watermark"?: Anonymize<I4arjljr6dpflb>;
    "consumed_go_ahead_signal"?: Anonymize<Iav8k1edbj86k7>;
};
export type I4arjljr6dpflb = (number) | undefined;
export type Ifn6q3equiq9qi = {
    "parent_head": Binary;
    "relay_parent_number": number;
    "relay_parent_storage_root": FixedSizeBinary<32>;
    "max_pov_size": number;
};
export type Ia3sb0vgvovhtg = (UpgradeRestriction) | undefined;
export type UpgradeRestriction = Enum<{
    "Present": undefined;
}>;
export declare const UpgradeRestriction: GetEnum<UpgradeRestriction>;
export type Itom7fk49o0c9 = Array<Binary>;
export type I4i91h98n3cv1b = {
    "dmq_mqc_head": FixedSizeBinary<32>;
    "relay_dispatch_queue_remaining_capacity": {
        "remaining_count": number;
        "remaining_size": number;
    };
    "ingress_channels": Array<[number, {
        "max_capacity": number;
        "max_total_size": number;
        "max_message_size": number;
        "msg_count": number;
        "total_size": number;
        "mqc_head"?: Anonymize<I4s6vifaf8k998>;
    }]>;
    "egress_channels": Array<[number, {
        "max_capacity": number;
        "max_total_size": number;
        "max_message_size": number;
        "msg_count": number;
        "total_size": number;
        "mqc_head"?: Anonymize<I4s6vifaf8k998>;
    }]>;
};
export type I4iumukclgj8ej = {
    "max_code_size": number;
    "max_head_data_size": number;
    "max_upward_queue_count": number;
    "max_upward_queue_size": number;
    "max_upward_message_size": number;
    "max_upward_message_num_per_candidate": number;
    "hrmp_max_message_num_per_candidate": number;
    "validation_upgrade_cooldown": number;
    "validation_upgrade_delay": number;
    "async_backing_params": {
        "max_candidate_depth": number;
        "allowed_ancestry_len": number;
    };
};
export type Iqnbvitf7a7l3 = Array<[number, FixedSizeBinary<32>]>;
export type I48i407regf59r = {
    "sent_at": number;
    "reverse_idx": number;
};
export type I6r5cbv8ttrb09 = Array<{
    "recipient": number;
    "data": Binary;
}>;
export type I8ds64oj6581v0 = Array<{
    "id": FixedSizeBinary<8>;
    "amount": bigint;
    "reasons": BalancesTypesReasons;
}>;
export type BalancesTypesReasons = Enum<{
    "Fee": undefined;
    "Misc": undefined;
    "All": undefined;
}>;
export declare const BalancesTypesReasons: GetEnum<BalancesTypesReasons>;
export type Ia7pdug7cdsg8g = Array<{
    "id": FixedSizeBinary<8>;
    "amount": bigint;
}>;
export type Iafsev9pf8ur2h = Array<{
    "id": Anonymize<Ia44l7h6l7vcfa>;
    "amount": bigint;
}>;
export type I9bin2jc70qt6q = Array<Anonymize<I3qt1hgg4djhgb>>;
export type TransactionPaymentReleases = Enum<{
    "V1Ancient": undefined;
    "V2": undefined;
}>;
export declare const TransactionPaymentReleases: GetEnum<TransactionPaymentReleases>;
export type I52552vmt51a1m = {
    "extent": {
        "transactions": number;
        "bytes": bigint;
    };
    "expiration": number;
};
export type Icd998p53cb80u = AnonymousEnum<{
    "Account": SS58String;
    "Preimage": FixedSizeBinary<32>;
}>;
export type Ianratlvp36bb8 = Array<{
    "chunk_root": FixedSizeBinary<32>;
    "content_hash": FixedSizeBinary<32>;
    "hashing": Anonymize<Ifmrgam3blcf8>;
    "cid_codec": bigint;
    "size": number;
    "block_chunks": number;
}>;
export type Ifmrgam3blcf8 = AnonymousEnum<{
    "Blake2b256": undefined;
    "Sha2_256": undefined;
    "Keccak256": undefined;
}>;
export type Ifi4da1gej1fri = Array<{
    "who": SS58String;
    "deposit": bigint;
}>;
export type Ifvgo9568rpmqc = Array<[SS58String, FixedSizeBinary<32>]>;
export type I6cs1itejju2vv = [bigint, number];
export type Icgljjb6j82uhn = Array<number>;
export type Ib77b0fp1a6mjr = Array<{
    "recipient": number;
    "state": Enum<{
        "Ok": undefined;
        "Suspended": undefined;
    }>;
    "signals_exist": boolean;
    "first_index": number;
    "last_index": number;
}>;
export type I5g2vv0ckl2m8b = [number, number];
export type Ifup3lg9ro8a0f = {
    "suspend_threshold": number;
    "drop_threshold": number;
    "resume_threshold": number;
};
export type I5qfubnuvrnqn6 = AnonymousEnum<{
    "Pending": {
        "responder": XcmVersionedLocation;
        "maybe_match_querier"?: (XcmVersionedLocation) | undefined;
        "maybe_notify"?: (FixedSizeBinary<2>) | undefined;
        "timeout": number;
    };
    "VersionNotifier": {
        "origin": XcmVersionedLocation;
        "is_active": boolean;
    };
    "Ready": {
        "response": Enum<{
            "V3": XcmV3Response;
            "V4": XcmV4Response;
            "V5": Anonymize<I7vucpgm2c6959>;
        }>;
        "at": number;
    };
}>;
export type XcmV3Response = Enum<{
    "Null": undefined;
    "Assets": Anonymize<Iai6dhqiq3bach>;
    "ExecutionResult"?: Anonymize<I7sltvf8v2nure>;
    "Version": number;
    "PalletsInfo": Anonymize<I599u7h20b52at>;
    "DispatchResult": XcmV3MaybeErrorCode;
}>;
export declare const XcmV3Response: GetEnum<XcmV3Response>;
export type I7sltvf8v2nure = ([number, XcmV3TraitsError]) | undefined;
export type XcmV3TraitsError = Enum<{
    "Overflow": undefined;
    "Unimplemented": undefined;
    "UntrustedReserveLocation": undefined;
    "UntrustedTeleportLocation": undefined;
    "LocationFull": undefined;
    "LocationNotInvertible": undefined;
    "BadOrigin": undefined;
    "InvalidLocation": undefined;
    "AssetNotFound": undefined;
    "FailedToTransactAsset": undefined;
    "NotWithdrawable": undefined;
    "LocationCannotHold": undefined;
    "ExceedsMaxMessageSize": undefined;
    "DestinationUnsupported": undefined;
    "Transport": undefined;
    "Unroutable": undefined;
    "UnknownClaim": undefined;
    "FailedToDecode": undefined;
    "MaxWeightInvalid": undefined;
    "NotHoldingFees": undefined;
    "TooExpensive": undefined;
    "Trap": bigint;
    "ExpectationFalse": undefined;
    "PalletNotFound": undefined;
    "NameMismatch": undefined;
    "VersionIncompatible": undefined;
    "HoldingWouldOverflow": undefined;
    "ExportError": undefined;
    "ReanchorFailed": undefined;
    "NoDeal": undefined;
    "FeesNotMet": undefined;
    "LockError": undefined;
    "NoPermission": undefined;
    "Unanchored": undefined;
    "NotDepositable": undefined;
    "UnhandledXcmVersion": undefined;
    "WeightLimitReached": Anonymize<I4q39t5hn830vp>;
    "Barrier": undefined;
    "WeightNotComputable": undefined;
    "ExceedsStackLimit": undefined;
}>;
export declare const XcmV3TraitsError: GetEnum<XcmV3TraitsError>;
export type XcmV4Response = Enum<{
    "Null": undefined;
    "Assets": Anonymize<I50mli3hb64f9b>;
    "ExecutionResult"?: Anonymize<I7sltvf8v2nure>;
    "Version": number;
    "PalletsInfo": Anonymize<I599u7h20b52at>;
    "DispatchResult": XcmV3MaybeErrorCode;
}>;
export declare const XcmV4Response: GetEnum<XcmV4Response>;
export type I8t3u2dv73ahbd = [number, XcmVersionedLocation];
export type I7vlvrrl2pnbgk = [bigint, Anonymize<I4q39t5hn830vp>, number];
export type Ie0rpl5bahldfk = Array<[XcmVersionedLocation, number]>;
export type XcmPalletVersionMigrationStage = Enum<{
    "MigrateSupportedVersion": undefined;
    "MigrateVersionNotifiers": undefined;
    "NotifyCurrentTargets"?: Anonymize<Iabpgqcjikia83>;
    "MigrateAndNotifyOldTargets": undefined;
}>;
export declare const XcmPalletVersionMigrationStage: GetEnum<XcmPalletVersionMigrationStage>;
export type I7e5oaj2qi4kl1 = {
    "amount": bigint;
    "owner": XcmVersionedLocation;
    "locker": XcmVersionedLocation;
    "consumers": Array<[undefined, bigint]>;
};
export type Ie849h3gncgvok = [number, SS58String, XcmVersionedAssetId];
export type XcmVersionedAssetId = Enum<{
    "V3": XcmV3MultiassetAssetId;
    "V4": Anonymize<I4c0s5cioidn76>;
    "V5": Anonymize<If9iqq7i64mur8>;
}>;
export declare const XcmVersionedAssetId: GetEnum<XcmVersionedAssetId>;
export type Iat62vud7hlod2 = Array<[bigint, XcmVersionedLocation]>;
export type Ibkm2gcn4pji30 = {
    "aliasers": Anonymize<I41j3fc5ema929>;
    "ticket": bigint;
};
export type I41j3fc5ema929 = Array<{
    "location": XcmVersionedLocation;
    "expiry"?: Anonymize<I35p85j063s0il>;
}>;
export type Idh2ug6ou4a8og = {
    "begin": number;
    "end": number;
    "count": number;
    "ready_neighbours"?: ({
        "prev": Anonymize<Iejeo53sea6n4q>;
        "next": Anonymize<Iejeo53sea6n4q>;
    }) | undefined;
    "message_count": bigint;
    "size": bigint;
};
export type I53esa2ms463bk = {
    "remaining": number;
    "remaining_size": number;
    "first_index": number;
    "first": number;
    "last": number;
    "heap": Binary;
};
export type Ib4jhb8tt3uung = [Anonymize<Iejeo53sea6n4q>, number];
export type In7a38730s6qs = {
    "base_block": Anonymize<I4q39t5hn830vp>;
    "max_block": Anonymize<I4q39t5hn830vp>;
    "per_class": {
        "normal": {
            "base_extrinsic": Anonymize<I4q39t5hn830vp>;
            "max_extrinsic"?: Anonymize<Iasb8k6ash5mjn>;
            "max_total"?: Anonymize<Iasb8k6ash5mjn>;
            "reserved"?: Anonymize<Iasb8k6ash5mjn>;
        };
        "operational": {
            "base_extrinsic": Anonymize<I4q39t5hn830vp>;
            "max_extrinsic"?: Anonymize<Iasb8k6ash5mjn>;
            "max_total"?: Anonymize<Iasb8k6ash5mjn>;
            "reserved"?: Anonymize<Iasb8k6ash5mjn>;
        };
        "mandatory": {
            "base_extrinsic": Anonymize<I4q39t5hn830vp>;
            "max_extrinsic"?: Anonymize<Iasb8k6ash5mjn>;
            "max_total"?: Anonymize<Iasb8k6ash5mjn>;
            "reserved"?: Anonymize<Iasb8k6ash5mjn>;
        };
    };
};
export type If15el53dd76v9 = {
    "normal": number;
    "operational": number;
    "mandatory": number;
};
export type I9s0ave7t0vnrk = {
    "read": bigint;
    "write": bigint;
};
export type I4fo08joqmcqnm = {
    "spec_name": string;
    "impl_name": string;
    "authoring_version": number;
    "spec_version": number;
    "impl_version": number;
    "apis": Array<[FixedSizeBinary<8>, number]>;
    "transaction_version": number;
    "system_version": number;
};
export type Iekve0i6djpd9f = AnonymousEnum<{
    /**
     * Make some on-chain remark.
     *
     * Can be executed by every `origin`.
     */
    "remark": Anonymize<I8ofcg5rbj0g2c>;
    /**
     * Set the number of pages in the WebAssembly environment's heap.
     */
    "set_heap_pages": Anonymize<I4adgbll7gku4i>;
    /**
     * Set the new runtime code.
     */
    "set_code": Anonymize<I6pjjpfvhvcfru>;
    /**
     * Set the new runtime code without doing any checks of the given `code`.
     *
     * Note that runtime upgrades will not run if this is called with a not-increasing spec
     * version!
     */
    "set_code_without_checks": Anonymize<I6pjjpfvhvcfru>;
    /**
     * Set some items of storage.
     */
    "set_storage": Anonymize<I9pj91mj79qekl>;
    /**
     * Kill some items from storage.
     */
    "kill_storage": Anonymize<I39uah9nss64h9>;
    /**
     * Kill all storage items with a key that starts with the given prefix.
     *
     * **NOTE:** We rely on the Root origin to provide us the number of subkeys under
     * the prefix we are removing to accurately calculate the weight of this function.
     */
    "kill_prefix": Anonymize<Ik64dknsq7k08>;
    /**
     * Make some on-chain remark and emit event.
     */
    "remark_with_event": Anonymize<I8ofcg5rbj0g2c>;
    /**
     * Authorize an upgrade to a given `code_hash` for the runtime. The runtime can be supplied
     * later.
     *
     * This call requires Root origin.
     */
    "authorize_upgrade": Anonymize<Ib51vk42m1po4n>;
    /**
     * Authorize an upgrade to a given `code_hash` for the runtime. The runtime can be supplied
     * later.
     *
     * WARNING: This authorizes an upgrade that will take place without any safety checks, for
     * example that the spec name remains the same and that the version number increases. Not
     * recommended for normal use. Use `authorize_upgrade` instead.
     *
     * This call requires Root origin.
     */
    "authorize_upgrade_without_checks": Anonymize<Ib51vk42m1po4n>;
    /**
     * Provide the preimage (runtime binary) `code` for an upgrade that has been authorized.
     *
     * If the authorization required a version check, this call will ensure the spec name
     * remains unchanged and that the spec version has increased.
     *
     * Depending on the runtime's `OnSetCode` configuration, this function may directly apply
     * the new `code` in the same block or attempt to schedule the upgrade.
     *
     * All origins are allowed.
     */
    "apply_authorized_upgrade": Anonymize<I6pjjpfvhvcfru>;
}>;
export type I8ofcg5rbj0g2c = {
    "remark": Binary;
};
export type I4adgbll7gku4i = {
    "pages": bigint;
};
export type I6pjjpfvhvcfru = {
    "code": Binary;
};
export type I9pj91mj79qekl = {
    "items": Array<FixedSizeArray<2, Binary>>;
};
export type I39uah9nss64h9 = {
    "keys": Anonymize<Itom7fk49o0c9>;
};
export type Ik64dknsq7k08 = {
    "prefix": Binary;
    "subkeys": number;
};
export type Ib51vk42m1po4n = {
    "code_hash": FixedSizeBinary<32>;
};
export type I3u72uvpuo4qrt = AnonymousEnum<{
    /**
     * Set the current validation data.
     *
     * This should be invoked exactly once per block. It will panic at the finalization
     * phase if the call was not invoked.
     *
     * The dispatch origin for this call must be `Inherent`
     *
     * As a side effect, this function upgrades the current validation function
     * if the appropriate time has come.
     */
    "set_validation_data": Anonymize<Ial23jn8hp0aen>;
    "sudo_send_upward_message": Anonymize<Ifpj261e8s63m3>;
}>;
export type Ial23jn8hp0aen = {
    "data": {
        "validation_data": Anonymize<Ifn6q3equiq9qi>;
        "relay_chain_state": Anonymize<Itom7fk49o0c9>;
        "relay_parent_descendants": Array<Anonymize<Ic952bubvq4k7d>>;
        "collator_peer_id"?: Anonymize<Iabpgqcjikia83>;
    };
    "inbound_messages_data": {
        "downward_messages": {
            "full_messages": Array<{
                "sent_at": number;
                "msg": Binary;
            }>;
            "hashed_messages": Array<Anonymize<Icqnh9ino03itn>>;
        };
        "horizontal_messages": {
            "full_messages": Array<[number, {
                "sent_at": number;
                "data": Binary;
            }]>;
            "hashed_messages": Array<[number, Anonymize<Icqnh9ino03itn>]>;
        };
    };
};
export type Ic952bubvq4k7d = {
    "parent_hash": FixedSizeBinary<32>;
    "number": number;
    "state_root": FixedSizeBinary<32>;
    "extrinsics_root": FixedSizeBinary<32>;
    "digest": Anonymize<I4mddgoa69c0a2>;
};
export type Icqnh9ino03itn = {
    "sent_at": number;
    "msg_hash": FixedSizeBinary<32>;
};
export type Ifpj261e8s63m3 = {
    "message": Binary;
};
export type I7d75gqfg6jh9c = AnonymousEnum<{
    /**
     * Set the current time.
     *
     * This call should be invoked exactly once per block. It will panic at the finalization
     * phase, if this call hasn't been invoked by that time.
     *
     * The timestamp should be greater than the previous one by the amount specified by
     * [`Config::MinimumPeriod`].
     *
     * The dispatch origin for this call must be _None_.
     *
     * This dispatch class is _Mandatory_ to ensure it gets executed in the block. Be aware
     * that changing the complexity of this call could result exhausting the resources in a
     * block to execute any other calls.
     *
     * ## Complexity
     * - `O(1)` (Note that implementations of `OnTimestampSet` must also be `O(1)`)
     * - 1 storage read and 1 storage mutation (codec `O(1)` because of `DidUpdate::take` in
     * `on_finalize`)
     * - 1 event handler `on_timestamp_set`. Must be `O(1)`.
     */
    "set": Anonymize<Idcr6u6361oad9>;
}>;
export type Idcr6u6361oad9 = {
    "now": bigint;
};
export type I1m0lb3kij0li6 = AnonymousEnum<{
    /**
     * Send a batch of dispatch calls.
     *
     * May be called from any origin except `None`.
     *
     * - `calls`: The calls to be dispatched from the same origin. The number of call must not
     * exceed the constant: `batched_calls_limit` (available in constant metadata).
     *
     * If origin is root then the calls are dispatched without checking origin filter. (This
     * includes bypassing `frame_system::Config::BaseCallFilter`).
     *
     * ## Complexity
     * - O(C) where C is the number of calls to be batched.
     *
     * This will return `Ok` in all circumstances. To determine the success of the batch, an
     * event is deposited. If a call failed and the batch was interrupted, then the
     * `BatchInterrupted` event is deposited, along with the number of successful calls made
     * and the error of the failed call. If all were successful, then the `BatchCompleted`
     * event is deposited.
     */
    "batch": Anonymize<If7r4ec4rcbutr>;
    /**
     * Send a call through an indexed pseudonym of the sender.
     *
     * Filter from origin are passed along. The call will be dispatched with an origin which
     * use the same filter as the origin of this call.
     *
     * NOTE: If you need to ensure that any account-based filtering is not honored (i.e.
     * because you expect `proxy` to have been used prior in the call stack and you do not want
     * the call restrictions to apply to any sub-accounts), then use `as_multi_threshold_1`
     * in the Multisig pallet instead.
     *
     * NOTE: Prior to version *12, this was called `as_limited_sub`.
     *
     * The dispatch origin for this call must be _Signed_.
     */
    "as_derivative": Anonymize<I4f7ojrl003883>;
    /**
     * Send a batch of dispatch calls and atomically execute them.
     * The whole transaction will rollback and fail if any of the calls failed.
     *
     * May be called from any origin except `None`.
     *
     * - `calls`: The calls to be dispatched from the same origin. The number of call must not
     * exceed the constant: `batched_calls_limit` (available in constant metadata).
     *
     * If origin is root then the calls are dispatched without checking origin filter. (This
     * includes bypassing `frame_system::Config::BaseCallFilter`).
     *
     * ## Complexity
     * - O(C) where C is the number of calls to be batched.
     */
    "batch_all": Anonymize<If7r4ec4rcbutr>;
    /**
     * Dispatches a function call with a provided origin.
     *
     * The dispatch origin for this call must be _Root_.
     *
     * ## Complexity
     * - O(1).
     */
    "dispatch_as": Anonymize<I9pcmvr27k88j6>;
    /**
     * Send a batch of dispatch calls.
     * Unlike `batch`, it allows errors and won't interrupt.
     *
     * May be called from any origin except `None`.
     *
     * - `calls`: The calls to be dispatched from the same origin. The number of call must not
     * exceed the constant: `batched_calls_limit` (available in constant metadata).
     *
     * If origin is root then the calls are dispatch without checking origin filter. (This
     * includes bypassing `frame_system::Config::BaseCallFilter`).
     *
     * ## Complexity
     * - O(C) where C is the number of calls to be batched.
     */
    "force_batch": Anonymize<If7r4ec4rcbutr>;
    /**
     * Dispatch a function call with a specified weight.
     *
     * This function does not check the weight of the call, and instead allows the
     * Root origin to specify the weight of the call.
     *
     * The dispatch origin for this call must be _Root_.
     */
    "with_weight": Anonymize<Ie5nfvp73mk1cp>;
    /**
     * Dispatch a fallback call in the event the main call fails to execute.
     * May be called from any origin except `None`.
     *
     * This function first attempts to dispatch the `main` call.
     * If the `main` call fails, the `fallback` is attemted.
     * if the fallback is successfully dispatched, the weights of both calls
     * are accumulated and an event containing the main call error is deposited.
     *
     * In the event of a fallback failure the whole call fails
     * with the weights returned.
     *
     * - `main`: The main call to be dispatched. This is the primary action to execute.
     * - `fallback`: The fallback call to be dispatched in case the `main` call fails.
     *
     * ## Dispatch Logic
     * - If the origin is `root`, both the main and fallback calls are executed without
     * applying any origin filters.
     * - If the origin is not `root`, the origin filter is applied to both the `main` and
     * `fallback` calls.
     *
     * ## Use Case
     * - Some use cases might involve submitting a `batch` type call in either main, fallback
     * or both.
     */
    "if_else": Anonymize<I39imp7k99fvuf>;
    /**
     * Dispatches a function call with a provided origin.
     *
     * Almost the same as [`Pallet::dispatch_as`] but forwards any error of the inner call.
     *
     * The dispatch origin for this call must be _Root_.
     */
    "dispatch_as_fallible": Anonymize<I9pcmvr27k88j6>;
}>;
export type If7r4ec4rcbutr = {
    "calls": Array<TxCallData>;
};
export type I4f7ojrl003883 = {
    "index": number;
    "call": TxCallData;
};
export type I9pcmvr27k88j6 = {
    "as_origin": Anonymize<I9g869l9vmunib>;
    "call": TxCallData;
};
export type Ie5nfvp73mk1cp = {
    "call": TxCallData;
    "weight": Anonymize<I4q39t5hn830vp>;
};
export type I39imp7k99fvuf = {
    "main": TxCallData;
    "fallback": TxCallData;
};
export type I9svldsp29mh87 = AnonymousEnum<{
    /**
     * Transfer some liquid free balance to another account.
     *
     * `transfer_allow_death` will set the `FreeBalance` of the sender and receiver.
     * If the sender's account is below the existential deposit as a result
     * of the transfer, the account will be reaped.
     *
     * The dispatch origin for this call must be `Signed` by the transactor.
     */
    "transfer_allow_death": Anonymize<I4ktuaksf5i1gk>;
    /**
     * Exactly as `transfer_allow_death`, except the origin must be root and the source account
     * may be specified.
     */
    "force_transfer": Anonymize<I9bqtpv2ii35mp>;
    /**
     * Same as the [`transfer_allow_death`] call, but with a check that the transfer will not
     * kill the origin account.
     *
     * 99% of the time you want [`transfer_allow_death`] instead.
     *
     * [`transfer_allow_death`]: struct.Pallet.html#method.transfer
     */
    "transfer_keep_alive": Anonymize<I4ktuaksf5i1gk>;
    /**
     * Transfer the entire transferable balance from the caller account.
     *
     * NOTE: This function only attempts to transfer _transferable_ balances. This means that
     * any locked, reserved, or existential deposits (when `keep_alive` is `true`), will not be
     * transferred by this function. To ensure that this function results in a killed account,
     * you might need to prepare the account by removing any reference counters, storage
     * deposits, etc...
     *
     * The dispatch origin of this call must be Signed.
     *
     * - `dest`: The recipient of the transfer.
     * - `keep_alive`: A boolean to determine if the `transfer_all` operation should send all
     * of the funds the account has, causing the sender account to be killed (false), or
     * transfer everything except at least the existential deposit, which will guarantee to
     * keep the sender account alive (true).
     */
    "transfer_all": Anonymize<I9j7pagd6d4bda>;
    /**
     * Unreserve some balance from a user by force.
     *
     * Can only be called by ROOT.
     */
    "force_unreserve": Anonymize<I2h9pmio37r7fb>;
    /**
     * Upgrade a specified account.
     *
     * - `origin`: Must be `Signed`.
     * - `who`: The account to be upgraded.
     *
     * This will waive the transaction fee if at least all but 10% of the accounts needed to
     * be upgraded. (We let some not have to be upgraded just in order to allow for the
     * possibility of churn).
     */
    "upgrade_accounts": Anonymize<Ibmr18suc9ikh9>;
    /**
     * Set the regular balance of a given account.
     *
     * The dispatch origin for this call is `root`.
     */
    "force_set_balance": Anonymize<I9iq22t0burs89>;
    /**
     * Adjust the total issuance in a saturating way.
     *
     * Can only be called by root and always needs a positive `delta`.
     *
     * # Example
     */
    "force_adjust_total_issuance": Anonymize<I5u8olqbbvfnvf>;
    /**
     * Burn the specified liquid free balance from the origin account.
     *
     * If the origin's account ends up below the existential deposit as a result
     * of the burn and `keep_alive` is false, the account will be reaped.
     *
     * Unlike sending funds to a _burn_ address, which merely makes the funds inaccessible,
     * this `burn` operation will reduce total issuance by the amount _burned_.
     */
    "burn": Anonymize<I5utcetro501ir>;
}>;
export type I4ktuaksf5i1gk = {
    "dest": MultiAddress;
    "value": bigint;
};
export type MultiAddress = Enum<{
    "Id": SS58String;
    "Index": undefined;
    "Raw": Binary;
    "Address32": FixedSizeBinary<32>;
    "Address20": FixedSizeBinary<20>;
}>;
export declare const MultiAddress: GetEnum<MultiAddress>;
export type I9bqtpv2ii35mp = {
    "source": MultiAddress;
    "dest": MultiAddress;
    "value": bigint;
};
export type I9j7pagd6d4bda = {
    "dest": MultiAddress;
    "keep_alive": boolean;
};
export type I2h9pmio37r7fb = {
    "who": MultiAddress;
    "amount": bigint;
};
export type Ibmr18suc9ikh9 = {
    "who": Anonymize<Ia2lhg7l2hilo3>;
};
export type I9iq22t0burs89 = {
    "who": MultiAddress;
    "new_free": bigint;
};
export type I5u8olqbbvfnvf = {
    "direction": BalancesAdjustmentDirection;
    "delta": bigint;
};
export type BalancesAdjustmentDirection = Enum<{
    "Increase": undefined;
    "Decrease": undefined;
}>;
export declare const BalancesAdjustmentDirection: GetEnum<BalancesAdjustmentDirection>;
export type I5utcetro501ir = {
    "value": bigint;
    "keep_alive": boolean;
};
export type I29pvdqcplt85e = AnonymousEnum<{
    /**
     * Index and store data off chain. Minimum data size is 1 byte, maximum is
     * `MaxTransactionSize`. Data will be removed after `RetentionPeriod` blocks, unless
     * `renew` is called.
     *
     * Authorization is required to store data using regular signed/unsigned transactions.
     * Regular signed transactions require account authorization (see
     * [`authorize_account`](Self::authorize_account)), regular unsigned transactions require
     * preimage authorization (see [`authorize_preimage`](Self::authorize_preimage)).
     *
     * Emits [`Stored`](Event::Stored) when successful.
     *
     * ## Complexity
     *
     * O(n*log(n)) of data size, as all data is pushed to an in-memory trie.
     */
    "store": Anonymize<Itrlf5b2o2l8q>;
    /**
     * Index and store data off chain with an explicit CID configuration.
     *
     * Behaves identically to [`store`](Self::store), but the CID configuration
     * (codec and hashing algorithm) is passed directly as a parameter.
     *
     * Emits [`Stored`](Event::Stored) when successful.
     */
    "store_with_cid_config": Anonymize<Icegg8a2cqf1gu>;
    /**
     * Renew previously stored data. Parameters are the block number that contains previous
     * `store` or `renew` call and transaction index within that block. Transaction index is
     * emitted in the `Stored` or `Renewed` event.
     *
     * As with [`store`](Self::store), authorization is required to renew data using regular
     * signed/unsigned transactions.
     *
     * Emits [`Renewed`](Event::Renewed) when successful.
     *
     * ## Complexity
     *
     * O(1).
     */
    "renew": Anonymize<I4vj3ndsquheo1>;
    /**
     * Check storage proof for block number `block_number() - RetentionPeriod`. If such a block
     * does not exist, the proof is expected to be `None`.
     *
     * ## Complexity
     *
     * Linear w.r.t the number of indexed transactions in the proved block for random probing.
     * There's a DB read for each transaction.
     */
    "check_proof": Anonymize<I7h5kud22qmfsg>;
    /**
     * Authorize an account to store up to a given amount of arbitrary data. The authorization
     * will expire after a configured number of blocks.
     *
     * If the account is already authorized to store data, this will increase the amount of
     * data the account is authorized to store (and the number of transactions the account may
     * submit to supply the data), and push back the expiration block.
     *
     * Parameters:
     *
     * - `who`: The account to be credited with an authorization to store data.
     * - `transactions`: The number of transactions that `who` may submit to supply that data.
     * - `bytes`: The number of bytes that `who` may submit.
     *
     * The origin for this call must be the pallet's `Authorizer`. Emits
     * [`AccountAuthorized`](Event::AccountAuthorized) when successful.
     */
    "authorize_account": Anonymize<I2i8iea6e4ne1j>;
    /**
     * Authorize anyone to store a preimage of the given content hash. The authorization will
     * expire after a configured number of blocks.
     *
     * If authorization already exists for a preimage of the given hash to be stored, the
     * maximum size of the preimage will be increased to `max_size`, and the expiration block
     * will be pushed back.
     *
     * Parameters:
     *
     * - `content_hash`: The hash of the data to be submitted. For [`store`](Self::store) this
     * is the BLAKE2b-256 hash; for [`store_with_cid_config`](Self::store_with_cid_config)
     * this is the hash produced by the CID config's hashing algorithm.
     * - `max_size`: The maximum size, in bytes, of the preimage.
     *
     * The origin for this call must be the pallet's `Authorizer`. Emits
     * [`PreimageAuthorized`](Event::PreimageAuthorized) when successful.
     */
    "authorize_preimage": Anonymize<I4jotama61aldv>;
    /**
     * Remove an expired account authorization from storage. Anyone can call this.
     *
     * Parameters:
     *
     * - `who`: The account with an expired authorization to remove.
     *
     * Emits [`ExpiredAccountAuthorizationRemoved`](Event::ExpiredAccountAuthorizationRemoved)
     * when successful.
     */
    "remove_expired_account_authorization": Anonymize<I4cbvqmqadhrea>;
    /**
     * Remove an expired preimage authorization from storage. Anyone can call this.
     *
     * Parameters:
     *
     * - `content_hash`: The BLAKE2b hash that was authorized.
     *
     * Emits
     * [`ExpiredPreimageAuthorizationRemoved`](Event::ExpiredPreimageAuthorizationRemoved)
     * when successful.
     */
    "remove_expired_preimage_authorization": Anonymize<I3rfugj0vt1ug5>;
    /**
     * Refresh the expiration of an existing authorization for an account.
     *
     * If the account does not have an authorization, the call will fail.
     *
     * Parameters:
     *
     * - `who`: The account to be credited with an authorization to store data.
     *
     * The origin for this call must be the pallet's `Authorizer`. Emits
     * [`AccountAuthorizationRefreshed`](Event::AccountAuthorizationRefreshed) when successful.
     */
    "refresh_account_authorization": Anonymize<I4cbvqmqadhrea>;
    /**
     * Refresh the expiration of an existing authorization for a preimage of a BLAKE2b hash.
     *
     * If the preimage does not have an authorization, the call will fail.
     *
     * Parameters:
     *
     * - `content_hash`: The BLAKE2b hash of the data to be submitted.
     *
     * The origin for this call must be the pallet's `Authorizer`. Emits
     * [`PreimageAuthorizationRefreshed`](Event::PreimageAuthorizationRefreshed) when
     * successful.
     */
    "refresh_preimage_authorization": Anonymize<I3rfugj0vt1ug5>;
}>;
export type Itrlf5b2o2l8q = {
    "data": Binary;
};
export type Icegg8a2cqf1gu = {
    "cid": {
        "codec": bigint;
        "hashing": Anonymize<Ifmrgam3blcf8>;
    };
    "data": Binary;
};
export type I4vj3ndsquheo1 = {
    "block": number;
    "index": number;
};
export type I7h5kud22qmfsg = {
    "proof": {
        "chunk": Binary;
        "proof": Anonymize<Itom7fk49o0c9>;
    };
};
export type I9dpq5287dur8b = AnonymousEnum<{
    /**
     * Set the list of invulnerable (fixed) collators. These collators must do some
     * preparation, namely to have registered session keys.
     *
     * The call will remove any accounts that have not registered keys from the set. That is,
     * it is non-atomic; the caller accepts all `AccountId`s passed in `new` _individually_ as
     * acceptable Invulnerables, and is not proposing a _set_ of new Invulnerables.
     *
     * This call does not maintain mutual exclusivity of `Invulnerables` and `Candidates`. It
     * is recommended to use a batch of `add_invulnerable` and `remove_invulnerable` instead. A
     * `batch_all` can also be used to enforce atomicity. If any candidates are included in
     * `new`, they should be removed with `remove_invulnerable_candidate` after execution.
     *
     * Must be called by the `UpdateOrigin`.
     */
    "set_invulnerables": Anonymize<Ifccifqltb5obi>;
    /**
     * Set the ideal number of non-invulnerable collators. If lowering this number, then the
     * number of running collators could be higher than this figure. Aside from that edge case,
     * there should be no other way to have more candidates than the desired number.
     *
     * The origin for this call must be the `UpdateOrigin`.
     */
    "set_desired_candidates": Anonymize<Iadtsfv699cq8b>;
    /**
     * Set the candidacy bond amount.
     *
     * If the candidacy bond is increased by this call, all current candidates which have a
     * deposit lower than the new bond will be kicked from the list and get their deposits
     * back.
     *
     * The origin for this call must be the `UpdateOrigin`.
     */
    "set_candidacy_bond": Anonymize<Ialpmgmhr3gk5r>;
    /**
     * Register this account as a collator candidate. The account must (a) already have
     * registered session keys and (b) be able to reserve the `CandidacyBond`.
     *
     * This call is not available to `Invulnerable` collators.
     */
    "register_as_candidate": undefined;
    /**
     * Deregister `origin` as a collator candidate. Note that the collator can only leave on
     * session change. The `CandidacyBond` will be unreserved immediately.
     *
     * This call will fail if the total number of candidates would drop below
     * `MinEligibleCollators`.
     */
    "leave_intent": undefined;
    /**
     * Add a new account `who` to the list of `Invulnerables` collators. `who` must have
     * registered session keys. If `who` is a candidate, they will be removed.
     *
     * The origin for this call must be the `UpdateOrigin`.
     */
    "add_invulnerable": Anonymize<I4cbvqmqadhrea>;
    /**
     * Remove an account `who` from the list of `Invulnerables` collators. `Invulnerables` must
     * be sorted.
     *
     * The origin for this call must be the `UpdateOrigin`.
     */
    "remove_invulnerable": Anonymize<I4cbvqmqadhrea>;
    /**
     * Update the candidacy bond of collator candidate `origin` to a new amount `new_deposit`.
     *
     * Setting a `new_deposit` that is lower than the current deposit while `origin` is
     * occupying a top-`DesiredCandidates` slot is not allowed.
     *
     * This call will fail if `origin` is not a collator candidate, the updated bond is lower
     * than the minimum candidacy bond, and/or the amount cannot be reserved.
     */
    "update_bond": Anonymize<I3sdol54kg5jaq>;
    /**
     * The caller `origin` replaces a candidate `target` in the collator candidate list by
     * reserving `deposit`. The amount `deposit` reserved by the caller must be greater than
     * the existing bond of the target it is trying to replace.
     *
     * This call will fail if the caller is already a collator candidate or invulnerable, the
     * caller does not have registered session keys, the target is not a collator candidate,
     * and/or the `deposit` amount cannot be reserved.
     */
    "take_candidate_slot": Anonymize<I8fougodaj6di6>;
}>;
export type Ifccifqltb5obi = {
    "new": Anonymize<Ia2lhg7l2hilo3>;
};
export type Iadtsfv699cq8b = {
    "max": number;
};
export type Ialpmgmhr3gk5r = {
    "bond": bigint;
};
export type I3sdol54kg5jaq = {
    "new_deposit": bigint;
};
export type I8fougodaj6di6 = {
    "deposit": bigint;
    "target": SS58String;
};
export type I77dda7hps0u37 = AnonymousEnum<{
    /**
     * Sets the session key(s) of the function caller to `keys`.
     *
     * Allows an account to set its session key prior to becoming a validator.
     * This doesn't take effect until the next session.
     *
     * - `origin`: The dispatch origin of this function must be signed.
     * - `keys`: The new session keys to set. These are the public keys of all sessions keys
     * setup in the runtime.
     * - `proof`: The proof that `origin` has access to the private keys of `keys`. See
     * [`impl_opaque_keys`](sp_runtime::impl_opaque_keys) for more information about the
     * proof format.
     */
    "set_keys": Anonymize<I81vt5eq60l4b6>;
    /**
     * Removes any session key(s) of the function caller.
     *
     * This doesn't take effect until the next session.
     *
     * The dispatch origin of this function must be Signed and the account must be either be
     * convertible to a validator ID using the chain's typical addressing system (this usually
     * means being a controller account) or directly convertible into a validator ID (which
     * usually means being a stash account).
     */
    "purge_keys": undefined;
}>;
export type I81vt5eq60l4b6 = {
    "keys": FixedSizeBinary<32>;
    "proof": Binary;
};
export type Ib7tahn20bvsep = AnonymousEnum<{
    /**
     * Suspends all XCM executions for the XCMP queue, regardless of the sender's origin.
     *
     * - `origin`: Must pass `ControllerOrigin`.
     */
    "suspend_xcm_execution": undefined;
    /**
     * Resumes all XCM executions for the XCMP queue.
     *
     * Note that this function doesn't change the status of the in/out bound channels.
     *
     * - `origin`: Must pass `ControllerOrigin`.
     */
    "resume_xcm_execution": undefined;
    /**
     * Overwrites the number of pages which must be in the queue for the other side to be
     * told to suspend their sending.
     *
     * - `origin`: Must pass `Root`.
     * - `new`: Desired value for `QueueConfigData.suspend_value`
     */
    "update_suspend_threshold": Anonymize<I3vh014cqgmrfd>;
    /**
     * Overwrites the number of pages which must be in the queue after which we drop any
     * further messages from the channel.
     *
     * - `origin`: Must pass `Root`.
     * - `new`: Desired value for `QueueConfigData.drop_threshold`
     */
    "update_drop_threshold": Anonymize<I3vh014cqgmrfd>;
    /**
     * Overwrites the number of pages which the queue must be reduced to before it signals
     * that message sending may recommence after it has been suspended.
     *
     * - `origin`: Must pass `Root`.
     * - `new`: Desired value for `QueueConfigData.resume_threshold`
     */
    "update_resume_threshold": Anonymize<I3vh014cqgmrfd>;
}>;
export type I3vh014cqgmrfd = {
    "new": number;
};
export type I6k1inef986368 = AnonymousEnum<{
    "send": Anonymize<Ia5cotcvi888ln>;
    /**
     * Teleport some assets from the local chain to some destination chain.
     *
     * **This function is deprecated: Use `limited_teleport_assets` instead.**
     *
     * Fee payment on the destination side is made from the asset in the `assets` vector of
     * index `fee_asset_item`. The weight limit for fees is not provided and thus is unlimited,
     * with all fees taken as needed from the asset.
     *
     * - `origin`: Must be capable of withdrawing the `assets` and executing XCM.
     * - `dest`: Destination context for the assets. Will typically be `[Parent,
     * Parachain(..)]` to send from parachain to parachain, or `[Parachain(..)]` to send from
     * relay to parachain.
     * - `beneficiary`: A beneficiary location for the assets in the context of `dest`. Will
     * generally be an `AccountId32` value.
     * - `assets`: The assets to be withdrawn. This should include the assets used to pay the
     * fee on the `dest` chain.
     * - `fee_asset_item`: The index into `assets` of the item which should be used to pay
     * fees.
     */
    "teleport_assets": Anonymize<I21jsa919m88fd>;
    /**
     * Transfer some assets from the local chain to the destination chain through their local,
     * destination or remote reserve.
     *
     * `assets` must have same reserve location and may not be teleportable to `dest`.
     * - `assets` have local reserve: transfer assets to sovereign account of destination
     * chain and forward a notification XCM to `dest` to mint and deposit reserve-based
     * assets to `beneficiary`.
     * - `assets` have destination reserve: burn local assets and forward a notification to
     * `dest` chain to withdraw the reserve assets from this chain's sovereign account and
     * deposit them to `beneficiary`.
     * - `assets` have remote reserve: burn local assets, forward XCM to reserve chain to move
     * reserves from this chain's SA to `dest` chain's SA, and forward another XCM to `dest`
     * to mint and deposit reserve-based assets to `beneficiary`.
     *
     * **This function is deprecated: Use `limited_reserve_transfer_assets` instead.**
     *
     * Fee payment on the destination side is made from the asset in the `assets` vector of
     * index `fee_asset_item`. The weight limit for fees is not provided and thus is unlimited,
     * with all fees taken as needed from the asset.
     *
     * - `origin`: Must be capable of withdrawing the `assets` and executing XCM.
     * - `dest`: Destination context for the assets. Will typically be `[Parent,
     * Parachain(..)]` to send from parachain to parachain, or `[Parachain(..)]` to send from
     * relay to parachain.
     * - `beneficiary`: A beneficiary location for the assets in the context of `dest`. Will
     * generally be an `AccountId32` value.
     * - `assets`: The assets to be withdrawn. This should include the assets used to pay the
     * fee on the `dest` (and possibly reserve) chains.
     * - `fee_asset_item`: The index into `assets` of the item which should be used to pay
     * fees.
     */
    "reserve_transfer_assets": Anonymize<I21jsa919m88fd>;
    /**
     * Execute an XCM message from a local, signed, origin.
     *
     * An event is deposited indicating whether `msg` could be executed completely or only
     * partially.
     *
     * No more than `max_weight` will be used in its attempted execution. If this is less than
     * the maximum amount of weight that the message could take to be executed, then no
     * execution attempt will be made.
     */
    "execute": Anonymize<Iegif7m3upfe1k>;
    /**
     * Extoll that a particular destination can be communicated with through a particular
     * version of XCM.
     *
     * - `origin`: Must be an origin specified by AdminOrigin.
     * - `location`: The destination that is being described.
     * - `xcm_version`: The latest version of XCM that `location` supports.
     */
    "force_xcm_version": Anonymize<I9kt8c221c83ln>;
    /**
     * Set a safe XCM version (the version that XCM should be encoded with if the most recent
     * version a destination can accept is unknown).
     *
     * - `origin`: Must be an origin specified by AdminOrigin.
     * - `maybe_xcm_version`: The default XCM encoding version, or `None` to disable.
     */
    "force_default_xcm_version": Anonymize<Ic76kfh5ebqkpl>;
    /**
     * Ask a location to notify us regarding their XCM version and any changes to it.
     *
     * - `origin`: Must be an origin specified by AdminOrigin.
     * - `location`: The location to which we should subscribe for XCM version notifications.
     */
    "force_subscribe_version_notify": Anonymize<Icscpmubum33bq>;
    /**
     * Require that a particular destination should no longer notify us regarding any XCM
     * version changes.
     *
     * - `origin`: Must be an origin specified by AdminOrigin.
     * - `location`: The location to which we are currently subscribed for XCM version
     * notifications which we no longer desire.
     */
    "force_unsubscribe_version_notify": Anonymize<Icscpmubum33bq>;
    /**
     * Transfer some assets from the local chain to the destination chain through their local,
     * destination or remote reserve.
     *
     * `assets` must have same reserve location and may not be teleportable to `dest`.
     * - `assets` have local reserve: transfer assets to sovereign account of destination
     * chain and forward a notification XCM to `dest` to mint and deposit reserve-based
     * assets to `beneficiary`.
     * - `assets` have destination reserve: burn local assets and forward a notification to
     * `dest` chain to withdraw the reserve assets from this chain's sovereign account and
     * deposit them to `beneficiary`.
     * - `assets` have remote reserve: burn local assets, forward XCM to reserve chain to move
     * reserves from this chain's SA to `dest` chain's SA, and forward another XCM to `dest`
     * to mint and deposit reserve-based assets to `beneficiary`.
     *
     * Fee payment on the destination side is made from the asset in the `assets` vector of
     * index `fee_asset_item`, up to enough to pay for `weight_limit` of weight. If more weight
     * is needed than `weight_limit`, then the operation will fail and the sent assets may be
     * at risk.
     *
     * - `origin`: Must be capable of withdrawing the `assets` and executing XCM.
     * - `dest`: Destination context for the assets. Will typically be `[Parent,
     * Parachain(..)]` to send from parachain to parachain, or `[Parachain(..)]` to send from
     * relay to parachain.
     * - `beneficiary`: A beneficiary location for the assets in the context of `dest`. Will
     * generally be an `AccountId32` value.
     * - `assets`: The assets to be withdrawn. This should include the assets used to pay the
     * fee on the `dest` (and possibly reserve) chains.
     * - `fee_asset_item`: The index into `assets` of the item which should be used to pay
     * fees.
     * - `weight_limit`: The remote-side weight limit, if any, for the XCM fee purchase.
     */
    "limited_reserve_transfer_assets": Anonymize<I21d2olof7eb60>;
    /**
     * Teleport some assets from the local chain to some destination chain.
     *
     * Fee payment on the destination side is made from the asset in the `assets` vector of
     * index `fee_asset_item`, up to enough to pay for `weight_limit` of weight. If more weight
     * is needed than `weight_limit`, then the operation will fail and the sent assets may be
     * at risk.
     *
     * - `origin`: Must be capable of withdrawing the `assets` and executing XCM.
     * - `dest`: Destination context for the assets. Will typically be `[Parent,
     * Parachain(..)]` to send from parachain to parachain, or `[Parachain(..)]` to send from
     * relay to parachain.
     * - `beneficiary`: A beneficiary location for the assets in the context of `dest`. Will
     * generally be an `AccountId32` value.
     * - `assets`: The assets to be withdrawn. This should include the assets used to pay the
     * fee on the `dest` chain.
     * - `fee_asset_item`: The index into `assets` of the item which should be used to pay
     * fees.
     * - `weight_limit`: The remote-side weight limit, if any, for the XCM fee purchase.
     */
    "limited_teleport_assets": Anonymize<I21d2olof7eb60>;
    /**
     * Set or unset the global suspension state of the XCM executor.
     *
     * - `origin`: Must be an origin specified by AdminOrigin.
     * - `suspended`: `true` to suspend, `false` to resume.
     */
    "force_suspension": Anonymize<Ibgm4rnf22lal1>;
    /**
     * Transfer some assets from the local chain to the destination chain through their local,
     * destination or remote reserve, or through teleports.
     *
     * Fee payment on the destination side is made from the asset in the `assets` vector of
     * index `fee_asset_item` (hence referred to as `fees`), up to enough to pay for
     * `weight_limit` of weight. If more weight is needed than `weight_limit`, then the
     * operation will fail and the sent assets may be at risk.
     *
     * `assets` (excluding `fees`) must have same reserve location or otherwise be teleportable
     * to `dest`, no limitations imposed on `fees`.
     * - for local reserve: transfer assets to sovereign account of destination chain and
     * forward a notification XCM to `dest` to mint and deposit reserve-based assets to
     * `beneficiary`.
     * - for destination reserve: burn local assets and forward a notification to `dest` chain
     * to withdraw the reserve assets from this chain's sovereign account and deposit them
     * to `beneficiary`.
     * - for remote reserve: burn local assets, forward XCM to reserve chain to move reserves
     * from this chain's SA to `dest` chain's SA, and forward another XCM to `dest` to mint
     * and deposit reserve-based assets to `beneficiary`.
     * - for teleports: burn local assets and forward XCM to `dest` chain to mint/teleport
     * assets and deposit them to `beneficiary`.
     *
     * - `origin`: Must be capable of withdrawing the `assets` and executing XCM.
     * - `dest`: Destination context for the assets. Will typically be `X2(Parent,
     * Parachain(..))` to send from parachain to parachain, or `X1(Parachain(..))` to send
     * from relay to parachain.
     * - `beneficiary`: A beneficiary location for the assets in the context of `dest`. Will
     * generally be an `AccountId32` value.
     * - `assets`: The assets to be withdrawn. This should include the assets used to pay the
     * fee on the `dest` (and possibly reserve) chains.
     * - `fee_asset_item`: The index into `assets` of the item which should be used to pay
     * fees.
     * - `weight_limit`: The remote-side weight limit, if any, for the XCM fee purchase.
     */
    "transfer_assets": Anonymize<I21d2olof7eb60>;
    /**
     * Claims assets trapped on this pallet because of leftover assets during XCM execution.
     *
     * - `origin`: Anyone can call this extrinsic.
     * - `assets`: The exact assets that were trapped. Use the version to specify what version
     * was the latest when they were trapped.
     * - `beneficiary`: The location/account where the claimed assets will be deposited.
     */
    "claim_assets": Anonymize<Ie68np0vpihith>;
    /**
     * Transfer assets from the local chain to the destination chain using explicit transfer
     * types for assets and fees.
     *
     * `assets` must have same reserve location or may be teleportable to `dest`. Caller must
     * provide the `assets_transfer_type` to be used for `assets`:
     * - `TransferType::LocalReserve`: transfer assets to sovereign account of destination
     * chain and forward a notification XCM to `dest` to mint and deposit reserve-based
     * assets to `beneficiary`.
     * - `TransferType::DestinationReserve`: burn local assets and forward a notification to
     * `dest` chain to withdraw the reserve assets from this chain's sovereign account and
     * deposit them to `beneficiary`.
     * - `TransferType::RemoteReserve(reserve)`: burn local assets, forward XCM to `reserve`
     * chain to move reserves from this chain's SA to `dest` chain's SA, and forward another
     * XCM to `dest` to mint and deposit reserve-based assets to `beneficiary`. Typically
     * the remote `reserve` is Asset Hub.
     * - `TransferType::Teleport`: burn local assets and forward XCM to `dest` chain to
     * mint/teleport assets and deposit them to `beneficiary`.
     *
     * On the destination chain, as well as any intermediary hops, `BuyExecution` is used to
     * buy execution using transferred `assets` identified by `remote_fees_id`.
     * Make sure enough of the specified `remote_fees_id` asset is included in the given list
     * of `assets`. `remote_fees_id` should be enough to pay for `weight_limit`. If more weight
     * is needed than `weight_limit`, then the operation will fail and the sent assets may be
     * at risk.
     *
     * `remote_fees_id` may use different transfer type than rest of `assets` and can be
     * specified through `fees_transfer_type`.
     *
     * The caller needs to specify what should happen to the transferred assets once they reach
     * the `dest` chain. This is done through the `custom_xcm_on_dest` parameter, which
     * contains the instructions to execute on `dest` as a final step.
     * This is usually as simple as:
     * `Xcm(vec![DepositAsset { assets: Wild(AllCounted(assets.len())), beneficiary }])`,
     * but could be something more exotic like sending the `assets` even further.
     *
     * - `origin`: Must be capable of withdrawing the `assets` and executing XCM.
     * - `dest`: Destination context for the assets. Will typically be `[Parent,
     * Parachain(..)]` to send from parachain to parachain, or `[Parachain(..)]` to send from
     * relay to parachain, or `(parents: 2, (GlobalConsensus(..), ..))` to send from
     * parachain across a bridge to another ecosystem destination.
     * - `assets`: The assets to be withdrawn. This should include the assets used to pay the
     * fee on the `dest` (and possibly reserve) chains.
     * - `assets_transfer_type`: The XCM `TransferType` used to transfer the `assets`.
     * - `remote_fees_id`: One of the included `assets` to be used to pay fees.
     * - `fees_transfer_type`: The XCM `TransferType` used to transfer the `fees` assets.
     * - `custom_xcm_on_dest`: The XCM to be executed on `dest` chain as the last step of the
     * transfer, which also determines what happens to the assets on the destination chain.
     * - `weight_limit`: The remote-side weight limit, if any, for the XCM fee purchase.
     */
    "transfer_assets_using_type_and_then": Anonymize<I9bnv6lu0crf1q>;
    /**
     * Authorize another `aliaser` location to alias into the local `origin` making this call.
     * The `aliaser` is only authorized until the provided `expiry` block number.
     * The call can also be used for a previously authorized alias in order to update its
     * `expiry` block number.
     *
     * Usually useful to allow your local account to be aliased into from a remote location
     * also under your control (like your account on another chain).
     *
     * WARNING: make sure the caller `origin` (you) trusts the `aliaser` location to act in
     * their/your name. Once authorized using this call, the `aliaser` can freely impersonate
     * `origin` in XCM programs executed on the local chain.
     */
    "add_authorized_alias": Anonymize<Iauhjqifrdklq7>;
    /**
     * Remove a previously authorized `aliaser` from the list of locations that can alias into
     * the local `origin` making this call.
     */
    "remove_authorized_alias": Anonymize<Ie1uso9m8rt5cf>;
    /**
     * Remove all previously authorized `aliaser`s that can alias into the local `origin`
     * making this call.
     */
    "remove_all_authorized_aliases": undefined;
}>;
export type Ia5cotcvi888ln = {
    "dest": XcmVersionedLocation;
    "message": XcmVersionedXcm;
};
export type XcmVersionedXcm = Enum<{
    "V3": Anonymize<Ianvng4e08j9ii>;
    "V4": Anonymize<Iegrepoo0c1jc5>;
    "V5": Anonymize<Ict03eedr8de9s>;
}>;
export declare const XcmVersionedXcm: GetEnum<XcmVersionedXcm>;
export type Ianvng4e08j9ii = Array<XcmV3Instruction>;
export type XcmV3Instruction = Enum<{
    "WithdrawAsset": Anonymize<Iai6dhqiq3bach>;
    "ReserveAssetDeposited": Anonymize<Iai6dhqiq3bach>;
    "ReceiveTeleportedAsset": Anonymize<Iai6dhqiq3bach>;
    "QueryResponse": {
        "query_id": bigint;
        "response": XcmV3Response;
        "max_weight": Anonymize<I4q39t5hn830vp>;
        "querier"?: Anonymize<Ia9cgf4r40b26h>;
    };
    "TransferAsset": {
        "assets": Anonymize<Iai6dhqiq3bach>;
        "beneficiary": Anonymize<I4c0s5cioidn76>;
    };
    "TransferReserveAsset": {
        "assets": Anonymize<Iai6dhqiq3bach>;
        "dest": Anonymize<I4c0s5cioidn76>;
        "xcm": Anonymize<Ianvng4e08j9ii>;
    };
    "Transact": Anonymize<I92p6l5cs3fr50>;
    "HrmpNewChannelOpenRequest": Anonymize<I5uhhrjqfuo4e5>;
    "HrmpChannelAccepted": Anonymize<Ifij4jam0o7sub>;
    "HrmpChannelClosing": Anonymize<Ieeb4svd9i8fji>;
    "ClearOrigin": undefined;
    "DescendOrigin": XcmV3Junctions;
    "ReportError": Anonymize<I4r3v6e91d1qbs>;
    "DepositAsset": {
        "assets": XcmV3MultiassetMultiAssetFilter;
        "beneficiary": Anonymize<I4c0s5cioidn76>;
    };
    "DepositReserveAsset": {
        "assets": XcmV3MultiassetMultiAssetFilter;
        "dest": Anonymize<I4c0s5cioidn76>;
        "xcm": Anonymize<Ianvng4e08j9ii>;
    };
    "ExchangeAsset": {
        "give": XcmV3MultiassetMultiAssetFilter;
        "want": Anonymize<Iai6dhqiq3bach>;
        "maximal": boolean;
    };
    "InitiateReserveWithdraw": {
        "assets": XcmV3MultiassetMultiAssetFilter;
        "reserve": Anonymize<I4c0s5cioidn76>;
        "xcm": Anonymize<Ianvng4e08j9ii>;
    };
    "InitiateTeleport": {
        "assets": XcmV3MultiassetMultiAssetFilter;
        "dest": Anonymize<I4c0s5cioidn76>;
        "xcm": Anonymize<Ianvng4e08j9ii>;
    };
    "ReportHolding": {
        "response_info": Anonymize<I4r3v6e91d1qbs>;
        "assets": XcmV3MultiassetMultiAssetFilter;
    };
    "BuyExecution": {
        "fees": Anonymize<Idcm24504c8bkk>;
        "weight_limit": XcmV3WeightLimit;
    };
    "RefundSurplus": undefined;
    "SetErrorHandler": Anonymize<Ianvng4e08j9ii>;
    "SetAppendix": Anonymize<Ianvng4e08j9ii>;
    "ClearError": undefined;
    "ClaimAsset": {
        "assets": Anonymize<Iai6dhqiq3bach>;
        "ticket": Anonymize<I4c0s5cioidn76>;
    };
    "Trap": bigint;
    "SubscribeVersion": Anonymize<Ieprdqqu7ildvr>;
    "UnsubscribeVersion": undefined;
    "BurnAsset": Anonymize<Iai6dhqiq3bach>;
    "ExpectAsset": Anonymize<Iai6dhqiq3bach>;
    "ExpectOrigin"?: Anonymize<Ia9cgf4r40b26h>;
    "ExpectError"?: Anonymize<I7sltvf8v2nure>;
    "ExpectTransactStatus": XcmV3MaybeErrorCode;
    "QueryPallet": Anonymize<Iba5bdbapp16oo>;
    "ExpectPallet": Anonymize<Id7mf37dkpgfjs>;
    "ReportTransactStatus": Anonymize<I4r3v6e91d1qbs>;
    "ClearTransactStatus": undefined;
    "UniversalOrigin": XcmV3Junction;
    "ExportMessage": {
        "network": XcmV3JunctionNetworkId;
        "destination": XcmV3Junctions;
        "xcm": Anonymize<Ianvng4e08j9ii>;
    };
    "LockAsset": {
        "asset": Anonymize<Idcm24504c8bkk>;
        "unlocker": Anonymize<I4c0s5cioidn76>;
    };
    "UnlockAsset": {
        "asset": Anonymize<Idcm24504c8bkk>;
        "target": Anonymize<I4c0s5cioidn76>;
    };
    "NoteUnlockable": {
        "asset": Anonymize<Idcm24504c8bkk>;
        "owner": Anonymize<I4c0s5cioidn76>;
    };
    "RequestUnlock": {
        "asset": Anonymize<Idcm24504c8bkk>;
        "locker": Anonymize<I4c0s5cioidn76>;
    };
    "SetFeesMode": Anonymize<I4nae9rsql8fa7>;
    "SetTopic": FixedSizeBinary<32>;
    "ClearTopic": undefined;
    "AliasOrigin": Anonymize<I4c0s5cioidn76>;
    "UnpaidExecution": Anonymize<I40d50jeai33oq>;
}>;
export declare const XcmV3Instruction: GetEnum<XcmV3Instruction>;
export type Ia9cgf4r40b26h = (Anonymize<I4c0s5cioidn76>) | undefined;
export type I92p6l5cs3fr50 = {
    "origin_kind": XcmV2OriginKind;
    "require_weight_at_most": Anonymize<I4q39t5hn830vp>;
    "call": Binary;
};
export type I4r3v6e91d1qbs = {
    "destination": Anonymize<I4c0s5cioidn76>;
    "query_id": bigint;
    "max_weight": Anonymize<I4q39t5hn830vp>;
};
export type XcmV3MultiassetMultiAssetFilter = Enum<{
    "Definite": Anonymize<Iai6dhqiq3bach>;
    "Wild": XcmV3MultiassetWildMultiAsset;
}>;
export declare const XcmV3MultiassetMultiAssetFilter: GetEnum<XcmV3MultiassetMultiAssetFilter>;
export type XcmV3MultiassetWildMultiAsset = Enum<{
    "All": undefined;
    "AllOf": {
        "id": XcmV3MultiassetAssetId;
        "fun": XcmV2MultiassetWildFungibility;
    };
    "AllCounted": number;
    "AllOfCounted": {
        "id": XcmV3MultiassetAssetId;
        "fun": XcmV2MultiassetWildFungibility;
        "count": number;
    };
}>;
export declare const XcmV3MultiassetWildMultiAsset: GetEnum<XcmV3MultiassetWildMultiAsset>;
export type Iba5bdbapp16oo = {
    "module_name": Binary;
    "response_info": Anonymize<I4r3v6e91d1qbs>;
};
export type I40d50jeai33oq = {
    "weight_limit": XcmV3WeightLimit;
    "check_origin"?: Anonymize<Ia9cgf4r40b26h>;
};
export type Iegrepoo0c1jc5 = Array<XcmV4Instruction>;
export type XcmV4Instruction = Enum<{
    "WithdrawAsset": Anonymize<I50mli3hb64f9b>;
    "ReserveAssetDeposited": Anonymize<I50mli3hb64f9b>;
    "ReceiveTeleportedAsset": Anonymize<I50mli3hb64f9b>;
    "QueryResponse": {
        "query_id": bigint;
        "response": XcmV4Response;
        "max_weight": Anonymize<I4q39t5hn830vp>;
        "querier"?: Anonymize<Ia9cgf4r40b26h>;
    };
    "TransferAsset": {
        "assets": Anonymize<I50mli3hb64f9b>;
        "beneficiary": Anonymize<I4c0s5cioidn76>;
    };
    "TransferReserveAsset": {
        "assets": Anonymize<I50mli3hb64f9b>;
        "dest": Anonymize<I4c0s5cioidn76>;
        "xcm": Anonymize<Iegrepoo0c1jc5>;
    };
    "Transact": Anonymize<I92p6l5cs3fr50>;
    "HrmpNewChannelOpenRequest": Anonymize<I5uhhrjqfuo4e5>;
    "HrmpChannelAccepted": Anonymize<Ifij4jam0o7sub>;
    "HrmpChannelClosing": Anonymize<Ieeb4svd9i8fji>;
    "ClearOrigin": undefined;
    "DescendOrigin": XcmV3Junctions;
    "ReportError": Anonymize<I4r3v6e91d1qbs>;
    "DepositAsset": {
        "assets": XcmV4AssetAssetFilter;
        "beneficiary": Anonymize<I4c0s5cioidn76>;
    };
    "DepositReserveAsset": {
        "assets": XcmV4AssetAssetFilter;
        "dest": Anonymize<I4c0s5cioidn76>;
        "xcm": Anonymize<Iegrepoo0c1jc5>;
    };
    "ExchangeAsset": {
        "give": XcmV4AssetAssetFilter;
        "want": Anonymize<I50mli3hb64f9b>;
        "maximal": boolean;
    };
    "InitiateReserveWithdraw": {
        "assets": XcmV4AssetAssetFilter;
        "reserve": Anonymize<I4c0s5cioidn76>;
        "xcm": Anonymize<Iegrepoo0c1jc5>;
    };
    "InitiateTeleport": {
        "assets": XcmV4AssetAssetFilter;
        "dest": Anonymize<I4c0s5cioidn76>;
        "xcm": Anonymize<Iegrepoo0c1jc5>;
    };
    "ReportHolding": {
        "response_info": Anonymize<I4r3v6e91d1qbs>;
        "assets": XcmV4AssetAssetFilter;
    };
    "BuyExecution": {
        "fees": Anonymize<Ia5l7mu5a6v49o>;
        "weight_limit": XcmV3WeightLimit;
    };
    "RefundSurplus": undefined;
    "SetErrorHandler": Anonymize<Iegrepoo0c1jc5>;
    "SetAppendix": Anonymize<Iegrepoo0c1jc5>;
    "ClearError": undefined;
    "ClaimAsset": {
        "assets": Anonymize<I50mli3hb64f9b>;
        "ticket": Anonymize<I4c0s5cioidn76>;
    };
    "Trap": bigint;
    "SubscribeVersion": Anonymize<Ieprdqqu7ildvr>;
    "UnsubscribeVersion": undefined;
    "BurnAsset": Anonymize<I50mli3hb64f9b>;
    "ExpectAsset": Anonymize<I50mli3hb64f9b>;
    "ExpectOrigin"?: Anonymize<Ia9cgf4r40b26h>;
    "ExpectError"?: Anonymize<I7sltvf8v2nure>;
    "ExpectTransactStatus": XcmV3MaybeErrorCode;
    "QueryPallet": Anonymize<Iba5bdbapp16oo>;
    "ExpectPallet": Anonymize<Id7mf37dkpgfjs>;
    "ReportTransactStatus": Anonymize<I4r3v6e91d1qbs>;
    "ClearTransactStatus": undefined;
    "UniversalOrigin": XcmV3Junction;
    "ExportMessage": {
        "network": XcmV3JunctionNetworkId;
        "destination": XcmV3Junctions;
        "xcm": Anonymize<Iegrepoo0c1jc5>;
    };
    "LockAsset": {
        "asset": Anonymize<Ia5l7mu5a6v49o>;
        "unlocker": Anonymize<I4c0s5cioidn76>;
    };
    "UnlockAsset": {
        "asset": Anonymize<Ia5l7mu5a6v49o>;
        "target": Anonymize<I4c0s5cioidn76>;
    };
    "NoteUnlockable": {
        "asset": Anonymize<Ia5l7mu5a6v49o>;
        "owner": Anonymize<I4c0s5cioidn76>;
    };
    "RequestUnlock": {
        "asset": Anonymize<Ia5l7mu5a6v49o>;
        "locker": Anonymize<I4c0s5cioidn76>;
    };
    "SetFeesMode": Anonymize<I4nae9rsql8fa7>;
    "SetTopic": FixedSizeBinary<32>;
    "ClearTopic": undefined;
    "AliasOrigin": Anonymize<I4c0s5cioidn76>;
    "UnpaidExecution": Anonymize<I40d50jeai33oq>;
}>;
export declare const XcmV4Instruction: GetEnum<XcmV4Instruction>;
export type XcmV4AssetAssetFilter = Enum<{
    "Definite": Anonymize<I50mli3hb64f9b>;
    "Wild": XcmV4AssetWildAsset;
}>;
export declare const XcmV4AssetAssetFilter: GetEnum<XcmV4AssetAssetFilter>;
export type XcmV4AssetWildAsset = Enum<{
    "All": undefined;
    "AllOf": {
        "id": Anonymize<I4c0s5cioidn76>;
        "fun": XcmV2MultiassetWildFungibility;
    };
    "AllCounted": number;
    "AllOfCounted": {
        "id": Anonymize<I4c0s5cioidn76>;
        "fun": XcmV2MultiassetWildFungibility;
        "count": number;
    };
}>;
export declare const XcmV4AssetWildAsset: GetEnum<XcmV4AssetWildAsset>;
export type I21jsa919m88fd = {
    "dest": XcmVersionedLocation;
    "beneficiary": XcmVersionedLocation;
    "assets": XcmVersionedAssets;
    "fee_asset_item": number;
};
export type Iegif7m3upfe1k = {
    "message": XcmVersionedXcm;
    "max_weight": Anonymize<I4q39t5hn830vp>;
};
export type Ic76kfh5ebqkpl = {
    "maybe_xcm_version"?: Anonymize<I4arjljr6dpflb>;
};
export type Icscpmubum33bq = {
    "location": XcmVersionedLocation;
};
export type I21d2olof7eb60 = {
    "dest": XcmVersionedLocation;
    "beneficiary": XcmVersionedLocation;
    "assets": XcmVersionedAssets;
    "fee_asset_item": number;
    "weight_limit": XcmV3WeightLimit;
};
export type Ibgm4rnf22lal1 = {
    "suspended": boolean;
};
export type Ie68np0vpihith = {
    "assets": XcmVersionedAssets;
    "beneficiary": XcmVersionedLocation;
};
export type I9bnv6lu0crf1q = {
    "dest": XcmVersionedLocation;
    "assets": XcmVersionedAssets;
    "assets_transfer_type": Enum<{
        "Teleport": undefined;
        "LocalReserve": undefined;
        "DestinationReserve": undefined;
        "RemoteReserve": XcmVersionedLocation;
    }>;
    "remote_fees_id": XcmVersionedAssetId;
    "fees_transfer_type": Enum<{
        "Teleport": undefined;
        "LocalReserve": undefined;
        "DestinationReserve": undefined;
        "RemoteReserve": XcmVersionedLocation;
    }>;
    "custom_xcm_on_dest": XcmVersionedXcm;
    "weight_limit": XcmV3WeightLimit;
};
export type Iauhjqifrdklq7 = {
    "aliaser": XcmVersionedLocation;
    "expires"?: Anonymize<I35p85j063s0il>;
};
export type Ie1uso9m8rt5cf = {
    "aliaser": XcmVersionedLocation;
};
export type Ic2uoe7jdksosp = AnonymousEnum<{
    /**
     * Remove a page which has no more messages remaining to be processed or is stale.
     */
    "reap_page": Anonymize<I40pqum1mu8qg3>;
    /**
     * Execute an overweight message.
     *
     * Temporary processing errors will be propagated whereas permanent errors are treated
     * as success condition.
     *
     * - `origin`: Must be `Signed`.
     * - `message_origin`: The origin from which the message to be executed arrived.
     * - `page`: The page in the queue in which the message to be executed is sitting.
     * - `index`: The index into the queue of the message to be executed.
     * - `weight_limit`: The maximum amount of weight allowed to be consumed in the execution
     * of the message.
     *
     * Benchmark complexity considerations: O(index + weight_limit).
     */
    "execute_overweight": Anonymize<I1r4c2ghbtvjuc>;
}>;
export type I40pqum1mu8qg3 = {
    "message_origin": Anonymize<Iejeo53sea6n4q>;
    "page_index": number;
};
export type I1r4c2ghbtvjuc = {
    "message_origin": Anonymize<Iejeo53sea6n4q>;
    "page": number;
    "index": number;
    "weight_limit": Anonymize<I4q39t5hn830vp>;
};
export type I88f5571cu27p4 = AnonymousEnum<{
    /**
     * Authenticates the sudo key and dispatches a function call with `Root` origin.
     */
    "sudo": Anonymize<I71iofbp4gm9ic>;
    /**
     * Authenticates the sudo key and dispatches a function call with `Root` origin.
     * This function does not check the weight of the call, and instead allows the
     * Sudo user to specify the weight of the call.
     *
     * The dispatch origin for this call must be _Signed_.
     */
    "sudo_unchecked_weight": Anonymize<Ie5nfvp73mk1cp>;
    /**
     * Authenticates the current sudo key and sets the given AccountId (`new`) as the new sudo
     * key.
     */
    "set_key": Anonymize<I8k3rnvpeeh4hv>;
    /**
     * Authenticates the sudo key and dispatches a function call with `Signed` origin from
     * a given account.
     *
     * The dispatch origin for this call must be _Signed_.
     */
    "sudo_as": Anonymize<Idb6pjdldfi4cc>;
    /**
     * Permanently removes the sudo key.
     *
     * **This cannot be un-done.**
     */
    "remove_key": undefined;
}>;
export type I71iofbp4gm9ic = {
    "call": TxCallData;
};
export type I8k3rnvpeeh4hv = {
    "new": MultiAddress;
};
export type Idb6pjdldfi4cc = {
    "who": MultiAddress;
    "call": TxCallData;
};
export type Iaqet9jc3ihboe = {
    "header": Anonymize<Ic952bubvq4k7d>;
    "extrinsics": Anonymize<Itom7fk49o0c9>;
};
export type I2v50gu3s1aqk6 = AnonymousEnum<{
    "AllExtrinsics": undefined;
    "OnlyInherents": undefined;
}>;
export type Ieeb2u9t56qdcr = ResultPayload<Anonymize<I46bjfmr3l2gfb>, Anonymize<I5nrjkj9qumobs>>;
export type I5nrjkj9qumobs = AnonymousEnum<{
    "Invalid": Enum<{
        "Call": undefined;
        "Payment": undefined;
        "Future": undefined;
        "Stale": undefined;
        "BadProof": undefined;
        "AncientBirthBlock": undefined;
        "ExhaustsResources": undefined;
        "Custom": number;
        "BadMandatory": undefined;
        "MandatoryValidation": undefined;
        "BadSigner": undefined;
        "IndeterminateImplicit": undefined;
        "UnknownOrigin": undefined;
    }>;
    "Unknown": TransactionValidityUnknownTransaction;
}>;
export type TransactionValidityUnknownTransaction = Enum<{
    "CannotLookup": undefined;
    "NoUnsignedValidator": undefined;
    "Custom": number;
}>;
export declare const TransactionValidityUnknownTransaction: GetEnum<TransactionValidityUnknownTransaction>;
export type If7uv525tdvv7a = Array<[FixedSizeBinary<8>, Binary]>;
export type I2an1fs2eiebjp = {
    "okay": boolean;
    "fatal_error": boolean;
    "errors": Anonymize<If7uv525tdvv7a>;
};
export type TransactionValidityTransactionSource = Enum<{
    "InBlock": undefined;
    "Local": undefined;
    "External": undefined;
}>;
export declare const TransactionValidityTransactionSource: GetEnum<TransactionValidityTransactionSource>;
export type I9ask1o4tfvcvs = ResultPayload<{
    "priority": bigint;
    "requires": Anonymize<Itom7fk49o0c9>;
    "provides": Anonymize<Itom7fk49o0c9>;
    "longevity": bigint;
    "propagate": boolean;
}, Anonymize<I5nrjkj9qumobs>>;
export type I4ph3d1eepnmr1 = {
    "keys": Binary;
    "proof": Binary;
};
export type Icerf8h8pdu8ss = (Array<[Binary, FixedSizeBinary<4>]>) | undefined;
export type I6spmpef2c7svf = {
    "weight": Anonymize<I4q39t5hn830vp>;
    "class": DispatchClass;
    "partial_fee": bigint;
};
export type Iei2mvq0mjvt81 = {
    "inclusion_fee"?: ({
        "base_fee": bigint;
        "len_fee": bigint;
        "adjusted_weight_fee": bigint;
    }) | undefined;
    "tip": bigint;
};
export type I70tguv6bl335o = AnonymousEnum<{
    "System": Anonymize<Iekve0i6djpd9f>;
    "ParachainSystem": Anonymize<I3u72uvpuo4qrt>;
    "Timestamp": Anonymize<I7d75gqfg6jh9c>;
    "ParachainInfo": undefined;
    "Utility": Anonymize<I1m0lb3kij0li6>;
    "Balances": Anonymize<I9svldsp29mh87>;
    "TransactionStorage": Anonymize<I29pvdqcplt85e>;
    "CollatorSelection": Anonymize<I9dpq5287dur8b>;
    "Session": Anonymize<I77dda7hps0u37>;
    "XcmpQueue": Anonymize<Ib7tahn20bvsep>;
    "PolkadotXcm": Anonymize<I6k1inef986368>;
    "CumulusXcm": undefined;
    "MessageQueue": Anonymize<Ic2uoe7jdksosp>;
    "Sudo": Anonymize<I88f5571cu27p4>;
}>;
export type Iftvbctbo05fu4 = ResultPayload<Array<XcmVersionedAssetId>, Anonymize<Iavct6f844hfju>>;
export type Iavct6f844hfju = AnonymousEnum<{
    "Unimplemented": undefined;
    "VersionedConversionFailed": undefined;
    "WeightNotComputable": undefined;
    "UnhandledXcmVersion": undefined;
    "AssetNotFound": undefined;
    "Unroutable": undefined;
}>;
export type Ic0c3req3mlc1l = ResultPayload<Anonymize<I4q39t5hn830vp>, Anonymize<Iavct6f844hfju>>;
export type I7ocn4njqde3v5 = ResultPayload<bigint, Anonymize<Iavct6f844hfju>>;
export type Iek7ha36da9mf5 = ResultPayload<XcmVersionedAssets, Anonymize<Iavct6f844hfju>>;
export type I2srrkue8s0910 = ResultPayload<{
    "execution_result": ResultPayload<Anonymize<Ia1u1r3n74r13c>, {
        "post_info": Anonymize<Ia1u1r3n74r13c>;
        "error": Anonymize<Id3cclc8rha27v>;
    }>;
    "emitted_events": Anonymize<I1r99afgt1kopa>;
    "local_xcm"?: (XcmVersionedXcm) | undefined;
    "forwarded_xcms": Anonymize<Ialhmrpub9sefe>;
}, Anonymize<I55ku9c5gk50hb>>;
export type Ia1u1r3n74r13c = {
    "actual_weight"?: Anonymize<Iasb8k6ash5mjn>;
    "pays_fee": Anonymize<Iehg04bj71rkd>;
};
export type I1r99afgt1kopa = Array<Anonymize<I1rke1a43hqelf>>;
export type Ialhmrpub9sefe = Array<[XcmVersionedLocation, Array<XcmVersionedXcm>]>;
export type I55ku9c5gk50hb = AnonymousEnum<{
    "Unimplemented": undefined;
    "VersionedConversionFailed": undefined;
}>;
export type I1abqdpbsc75ie = ResultPayload<{
    "execution_result": Anonymize<Ieqhmksji3pmv5>;
    "emitted_events": Anonymize<I1r99afgt1kopa>;
    "forwarded_xcms": Anonymize<Ialhmrpub9sefe>;
}, Anonymize<I55ku9c5gk50hb>>;
export type Ieh6nis3hdbtgi = ResultPayload<SS58String, Enum<{
    "Unsupported": undefined;
    "VersionedConversionFailed": undefined;
}>>;
export type XcmVersionedAsset = Enum<{
    "V3": Anonymize<Idcm24504c8bkk>;
    "V4": Anonymize<Ia5l7mu5a6v49o>;
    "V5": Anonymize<Iffh1nc5e1mod6>;
}>;
export declare const XcmVersionedAsset: GetEnum<XcmVersionedAsset>;
export type Icujp6hmv35vbn = ResultPayload<boolean, Enum<{
    "VersionedAssetConversionFailed": undefined;
    "VersionedLocationConversionFailed": undefined;
}>>;
export type I4tjame31218k9 = ResultPayload<Anonymize<I41j3fc5ema929>, Anonymize<Iecgqth5sdfqqi>>;
export type Iecgqth5sdfqqi = AnonymousEnum<{
    "LocationVersionConversionFailed": undefined;
}>;
export type I5gif8vomct5i8 = ResultPayload<boolean, Anonymize<Iecgqth5sdfqqi>>;
export type Ic1d4u2opv3fst = {
    "upward_messages": Anonymize<Itom7fk49o0c9>;
    "horizontal_messages": Anonymize<I6r5cbv8ttrb09>;
    "new_validation_code"?: Anonymize<Iabpgqcjikia83>;
    "processed_downward_messages": number;
    "hrmp_watermark": number;
    "head_data": Binary;
};
export type Ie9sr1iqcg3cgm = ResultPayload<undefined, string>;
export type I1mqgk2tmnn9i2 = (string) | undefined;
export type I6lr8sctk0bi4e = Array<string>;
export {};
