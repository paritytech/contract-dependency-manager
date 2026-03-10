# @example/instagram

Minimal on-chain Instagram contract for Polkadot (PolkaVM). Posts are indexed by `(user_address, sequential_index)`, enabling efficient client-side feed construction without complex on-chain ordering.

## Storage

| Field | Type | Description |
|---|---|---|
| `post_counts` | `Mapping<Address, u64>` | Number of posts per user |
| `posts` | `Mapping<(Address, u64), PostData>` | Post content keyed by user + index |
| `users` | `Mapping<u64, Address>` | Global user registry for discovery |
| `user_count` | `u64` | Total registered users |

Users are auto-registered on their first post.

## Methods

### `create_post(description: string, photo_cid: string) -> u64`

Creates a new post for the caller. Returns the post index. The `photo_cid` is typically a CID from Polkadot Bulletin (decentralised storage). Timestamps are recorded from the block.

### `get_post(user: bytes20, index: u64) -> Post`

Returns `{ description, photo_cid, timestamp }` for a given user's post. Reverts with `PostNotFound` if the index is out of range.

### `get_post_count(user: bytes20) -> u64`

Returns the number of posts a user has created.

### `get_user_count() -> u64`

Returns the total number of users who have posted.

### `get_user_at(index: u64) -> bytes20`

Returns a user's address by their registration index. Used for paginated user discovery.

## Feed Construction

The contract stores no global feed. Instead, the frontend builds feeds client-side:

1. Fetch `get_post_count` for each followed user
2. Traverse breadth-first: most recent post from each user, then second most recent, etc.
3. Fetch individual posts with `get_post(user, count - 1 - depth)`

This keeps the contract simple while enabling flexible feed algorithms off-chain.
