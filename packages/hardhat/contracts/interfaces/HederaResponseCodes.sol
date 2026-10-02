// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.0;

/// The Hedera response codes The Reserve checks for.
/// Full list: https://github.com/hashgraph/hedera-protobufs/blob/main/services/response_code.proto
library HederaResponseCodes {
    int64 internal constant SUCCESS = 22;
    int64 internal constant INSUFFICIENT_TOKEN_BALANCE = 178;
    int64 internal constant TOKEN_NOT_ASSOCIATED_TO_ACCOUNT = 184;
    int64 internal constant SPENDER_DOES_NOT_HAVE_ALLOWANCE = 292;
}
