import type { Package } from "./types";

export const packages: Package[] = [
  {
    name: "@polkadot/registries/contexts",
    version: "4",
    description:
      "Foundational registry for scoping contract namespaces. Manages named execution contexts that other contracts register under.",
    author: "Parity Technologies",
    weeklyCalls: 18400,
    license: "Apache-2.0",
    keywords: [
      "polkadot",
      "registry",
      "context",
      "namespace",
      "pvm",
      "smart-contract",
      "asset-hub",
    ],
    publishedDate: "2025-01-08",
    lastPublished: "3 weeks ago",
    repository: "https://github.com/paritytech/pvm-registries",
    homepage: "https://docs.polkadot.com/contracts/registries/contexts",
    readme: `# @polkadot/registries/contexts

Foundational registry for scoping contract namespaces on Polkadot Asset Hub. Manages named execution contexts (e.g., \`"production"\`, \`"staging"\`, \`"testnet"\`) that other contracts register under.

## Installation

\`\`\`bash
cdm add @polkadot/registries/contexts
\`\`\`

## Overview

Contexts provide isolation boundaries for contract ecosystems. A context acts as a top-level namespace under which contracts, users, and services are organized. This enables multi-tenant deployments where the same contract logic can operate independently across different contexts.

## Usage

\`\`\`rust
#![cfg_attr(not(feature = "std"), no_std, no_main)]

#[pvm::contract(cdm = "@polkadot/registries/contexts")]
mod contexts_registry {
    use pvm::prelude::*;

    #[derive(Debug, Clone, pvm::SolAbi)]
    pub struct Context {
        pub name: String,
        pub owner: Address,
        pub created_at: u64,
        pub active: bool,
    }

    #[pvm::storage]
    pub struct Storage {
        contexts: Mapping<String, Context>,
        owner_contexts: Mapping<Address, Vec<String>>,
        admin: Lazy<Address>,
    }

    #[pvm::method]
    fn create_context(&mut self, name: String) -> Result<(), Error> {
        let caller = pvm::caller();
        assert!(!self.contexts.contains(&name), "context already exists");

        let ctx = Context {
            name: name.clone(),
            owner: caller,
            created_at: pvm::block_timestamp(),
            active: true,
        };

        self.contexts.insert(&name, &ctx);

        let mut owned = self.owner_contexts.get(&caller).unwrap_or_default();
        owned.push(name);
        self.owner_contexts.insert(&caller, &owned);

        Ok(())
    }

    #[pvm::method]
    fn get_context(&self, name: String) -> Option<Context> {
        self.contexts.get(&name)
    }

    #[pvm::method]
    fn deactivate_context(&mut self, name: String) -> Result<(), Error> {
        let caller = pvm::caller();
        let mut ctx = self.contexts.get(&name).expect("context not found");
        assert!(ctx.owner == caller, "not the context owner");
        ctx.active = false;
        self.contexts.insert(&name, &ctx);
        Ok(())
    }
}
\`\`\`

## API Reference

| Method | Description |
|--------|-------------|
| \`create_context(name)\` | Register a new named context |
| \`get_context(name)\` | Look up a context by name |
| \`deactivate_context(name)\` | Deactivate an existing context |
| \`list_owner_contexts(addr)\` | List all contexts owned by an address |

## License

Apache-2.0`,
    dependencies: {},
    versions: [
      { version: "4", date: "2025-11-02" },
      { version: "3", date: "2025-08-19" },
      { version: "2", date: "2025-05-10" },
      { version: "1", date: "2025-01-08" },
    ],
  },
  {
    name: "@polkadot/registries/users",
    version: "5",
    description:
      "On-chain user identity registry. Maps addresses to user profiles including display names, avatars, and metadata URIs.",
    author: "Parity Technologies",
    weeklyCalls: 21200,
    license: "Apache-2.0",
    keywords: [
      "polkadot",
      "registry",
      "identity",
      "user",
      "profile",
      "pvm",
      "smart-contract",
    ],
    publishedDate: "2025-01-12",
    lastPublished: "2 months ago",
    repository: "https://github.com/paritytech/pvm-registries",
    homepage: "https://docs.polkadot.com/contracts/registries/users",
    readme: `# @polkadot/registries/users

On-chain user identity registry for Polkadot Asset Hub. Maps addresses to user profiles including display names, metadata URIs, and verification status.

## Installation

\`\`\`bash
cdm add @polkadot/registries/users
\`\`\`

## Overview

The user registry provides a canonical identity layer for the Polkadot contract ecosystem. Any address can register a profile containing a display name, avatar URI, and arbitrary metadata. Other contracts reference this registry to resolve human-readable identities from on-chain addresses.

## Usage

\`\`\`rust
#![cfg_attr(not(feature = "std"), no_std, no_main)]

#[pvm::contract(cdm = "@polkadot/registries/users")]
mod users_registry {
    use pvm::prelude::*;

    #[derive(Debug, Clone, pvm::SolAbi)]
    pub struct UserProfile {
        pub address: Address,
        pub display_name: String,
        pub metadata_uri: String,
        pub registered_at: u64,
    }

    #[pvm::storage]
    pub struct Storage {
        profiles: Mapping<Address, UserProfile>,
        name_to_address: Mapping<String, Address>,
        total_users: Lazy<u64>,
    }

    #[pvm::method]
    fn register(&mut self, display_name: String, metadata_uri: String) -> Result<(), Error> {
        let caller = pvm::caller();
        assert!(!self.profiles.contains(&caller), "already registered");
        assert!(
            !self.name_to_address.contains(&display_name),
            "display name taken"
        );

        let profile = UserProfile {
            address: caller,
            display_name: display_name.clone(),
            metadata_uri,
            registered_at: pvm::block_timestamp(),
        };

        self.profiles.insert(&caller, &profile);
        self.name_to_address.insert(&display_name, &caller);

        let count = self.total_users.get().unwrap_or(0);
        self.total_users.set(&(count + 1));

        Ok(())
    }

    #[pvm::method]
    fn get_profile(&self, address: Address) -> Option<UserProfile> {
        self.profiles.get(&address)
    }

    #[pvm::method]
    fn resolve_name(&self, display_name: String) -> Option<Address> {
        self.name_to_address.get(&display_name)
    }

    #[pvm::method]
    fn update_metadata(&mut self, metadata_uri: String) -> Result<(), Error> {
        let caller = pvm::caller();
        let mut profile = self.profiles.get(&caller).expect("not registered");
        profile.metadata_uri = metadata_uri;
        self.profiles.insert(&caller, &profile);
        Ok(())
    }
}
\`\`\`

## Cross-Contract Usage

Other contracts can resolve user profiles at runtime:

\`\`\`rust
let users = cdm_reference!("@polkadot/registries/users");
let profile = users.get_profile(some_address);
\`\`\`

## API Reference

| Method | Description |
|--------|-------------|
| \`register(name, uri)\` | Register a new user profile |
| \`get_profile(addr)\` | Get profile by address |
| \`resolve_name(name)\` | Resolve display name to address |
| \`update_metadata(uri)\` | Update profile metadata URI |

## License

Apache-2.0`,
    dependencies: {},
    versions: [
      { version: "5", date: "2025-10-14" },
      { version: "4", date: "2025-08-03" },
      { version: "3", date: "2025-05-22" },
      { version: "2", date: "2025-03-11" },
      { version: "1", date: "2025-01-12" },
    ],
  },
  {
    name: "@polkadot/reputation",
    version: "3",
    description:
      "Decentralized reputation scoring system for Polkadot. Tracks ratings, endorsements, and trust scores per user and context.",
    author: "Parity Technologies",
    weeklyCalls: 14800,
    license: "Apache-2.0",
    keywords: [
      "polkadot",
      "reputation",
      "trust",
      "rating",
      "endorsement",
      "pvm",
      "smart-contract",
    ],
    publishedDate: "2025-02-20",
    lastPublished: "5 weeks ago",
    repository: "https://github.com/paritytech/pvm-reputation",
    homepage: "https://docs.polkadot.com/contracts/reputation",
    readme: `# @polkadot/reputation

Decentralized reputation scoring system for the Polkadot contract ecosystem. Tracks ratings, endorsements, and composite trust scores per user and context.

## Installation

\`\`\`bash
cdm add @polkadot/reputation
\`\`\`

## Overview

The reputation contract provides a composable trust layer that other contracts can integrate. Users accumulate reputation through endorsements, successful transactions, and peer ratings. Scores are contextual \u2014 a user may have different reputation in different domains (e.g., development vs. design).

Depends on \`@polkadot/registries/users\` for identity resolution.

## Usage

\`\`\`rust
#![cfg_attr(not(feature = "std"), no_std, no_main)]

#[pvm::contract(cdm = "@polkadot/reputation")]
mod reputation {
    use pvm::prelude::*;

    #[derive(Debug, Clone, pvm::SolAbi)]
    pub struct ReputationScore {
        pub user: Address,
        pub domain: String,
        pub score: u64,
        pub total_ratings: u64,
        pub endorsements: u64,
    }

    #[pvm::storage]
    pub struct Storage {
        scores: Mapping<(Address, String), ReputationScore>,
        given_ratings: Mapping<(Address, Address, String), u8>,
        users: Lazy<cdm_reference!("@polkadot/registries/users")>,
    }

    #[pvm::method]
    fn rate_user(
        &mut self,
        target: Address,
        domain: String,
        rating: u8,
    ) -> Result<(), Error> {
        let caller = pvm::caller();
        assert!(rating >= 1 && rating <= 5, "rating must be 1-5");
        assert!(caller != target, "cannot rate yourself");

        // Verify both users are registered
        let users = self.users.get().unwrap();
        assert!(users.get_profile(caller).is_some(), "caller not registered");
        assert!(users.get_profile(target).is_some(), "target not registered");

        let key = (target, domain.clone());
        let mut score = self.scores.get(&key).unwrap_or(ReputationScore {
            user: target,
            domain: domain.clone(),
            score: 0,
            total_ratings: 0,
            endorsements: 0,
        });

        score.score = ((score.score * score.total_ratings) + rating as u64)
            / (score.total_ratings + 1);
        score.total_ratings += 1;

        self.scores.insert(&key, &score);
        self.given_ratings.insert(&(caller, target, domain), &rating);

        Ok(())
    }

    #[pvm::method]
    fn endorse(&mut self, target: Address, domain: String) -> Result<(), Error> {
        let caller = pvm::caller();
        let key = (target, domain.clone());
        let mut score = self.scores.get(&key).unwrap_or(ReputationScore {
            user: target,
            domain,
            score: 0,
            total_ratings: 0,
            endorsements: 0,
        });
        score.endorsements += 1;
        self.scores.insert(&key, &score);
        Ok(())
    }

    #[pvm::method]
    fn get_reputation(&self, user: Address, domain: String) -> Option<ReputationScore> {
        self.scores.get(&(user, domain))
    }
}
\`\`\`

## Cross-Contract Integration

Other contracts can query reputation scores at runtime:

\`\`\`rust
let reputation = cdm_reference!("@polkadot/reputation");
let score = reputation.get_reputation(user_addr, "development".into());
if let Some(s) = score {
    assert!(s.score >= 3, "insufficient reputation");
}
\`\`\`

## API Reference

| Method | Description |
|--------|-------------|
| \`rate_user(target, domain, rating)\` | Rate a user (1-5) in a domain |
| \`endorse(target, domain)\` | Endorse a user in a domain |
| \`get_reputation(user, domain)\` | Get reputation score for a user/domain |

## License

Apache-2.0`,
    dependencies: {
      "@polkadot/registries/users": "5",
    },
    versions: [
      { version: "3", date: "2025-09-28" },
      { version: "2", date: "2025-06-15" },
      { version: "1", date: "2025-02-20" },
    ],
  },
  {
    name: "@polkadot/disputes",
    version: "3",
    description:
      "Dispute resolution protocol for Polkadot contracts. Handles evidence submission, arbitration voting, and outcome enforcement.",
    author: "Parity Technologies",
    weeklyCalls: 9600,
    license: "Apache-2.0",
    keywords: [
      "polkadot",
      "dispute",
      "arbitration",
      "resolution",
      "escrow",
      "pvm",
      "smart-contract",
    ],
    publishedDate: "2025-03-05",
    lastPublished: "6 weeks ago",
    repository: "https://github.com/paritytech/pvm-disputes",
    homepage: "https://docs.polkadot.com/contracts/disputes",
    readme: `# @polkadot/disputes

On-chain dispute resolution protocol for the Polkadot contract ecosystem. Provides structured evidence submission, arbitration voting by reputable peers, and automated outcome enforcement.

## Installation

\`\`\`bash
cdm add @polkadot/disputes
\`\`\`

## Overview

The disputes contract implements a multi-phase resolution protocol:

1. **Filing** \u2014 A party opens a dispute with evidence and a stake
2. **Response** \u2014 The counterparty submits their evidence
3. **Arbitration** \u2014 Qualified arbitrators (selected by reputation) review and vote
4. **Enforcement** \u2014 The outcome is enforced on-chain (fund release, penalty, etc.)

Depends on \`@polkadot/reputation\` for arbitrator qualification and \`@polkadot/registries/users\` for identity.

## Usage

\`\`\`rust
#![cfg_attr(not(feature = "std"), no_std, no_main)]

#[pvm::contract(cdm = "@polkadot/disputes")]
mod disputes {
    use pvm::prelude::*;

    #[derive(Debug, Clone, pvm::SolAbi)]
    pub enum DisputeStatus {
        Filed,
        Responded,
        UnderArbitration,
        Resolved,
    }

    #[derive(Debug, Clone, pvm::SolAbi)]
    pub struct Dispute {
        pub id: u64,
        pub plaintiff: Address,
        pub defendant: Address,
        pub evidence_uri: String,
        pub response_uri: String,
        pub status: DisputeStatus,
        pub outcome: Option<bool>,
        pub created_at: u64,
    }

    #[pvm::storage]
    pub struct Storage {
        disputes: Mapping<u64, Dispute>,
        next_id: Lazy<u64>,
        votes: Mapping<(u64, Address), bool>,
        reputation: Lazy<cdm_reference!("@polkadot/reputation")>,
        users: Lazy<cdm_reference!("@polkadot/registries/users")>,
    }

    #[pvm::method]
    fn file_dispute(
        &mut self,
        defendant: Address,
        evidence_uri: String,
    ) -> Result<u64, Error> {
        let caller = pvm::caller();
        let users = self.users.get().unwrap();
        assert!(users.get_profile(caller).is_some(), "not registered");

        let id = self.next_id.get().unwrap_or(1);
        let dispute = Dispute {
            id,
            plaintiff: caller,
            defendant,
            evidence_uri,
            response_uri: String::new(),
            status: DisputeStatus::Filed,
            outcome: None,
            created_at: pvm::block_timestamp(),
        };

        self.disputes.insert(&id, &dispute);
        self.next_id.set(&(id + 1));
        Ok(id)
    }

    #[pvm::method]
    fn respond(&mut self, dispute_id: u64, response_uri: String) -> Result<(), Error> {
        let caller = pvm::caller();
        let mut dispute = self.disputes.get(&dispute_id).expect("not found");
        assert!(caller == dispute.defendant, "not defendant");
        dispute.response_uri = response_uri;
        dispute.status = DisputeStatus::Responded;
        self.disputes.insert(&dispute_id, &dispute);
        Ok(())
    }

    #[pvm::method]
    fn cast_vote(&mut self, dispute_id: u64, in_favor: bool) -> Result<(), Error> {
        let caller = pvm::caller();
        let reputation = self.reputation.get().unwrap();
        let rep = reputation
            .get_reputation(caller, "arbitration".into())
            .expect("no arbitrator reputation");
        assert!(rep.score >= 4, "insufficient arbitrator reputation");

        self.votes.insert(&(dispute_id, caller), &in_favor);
        Ok(())
    }

    #[pvm::method]
    fn get_dispute(&self, dispute_id: u64) -> Option<Dispute> {
        self.disputes.get(&dispute_id)
    }
}
\`\`\`

## API Reference

| Method | Description |
|--------|-------------|
| \`file_dispute(defendant, evidence)\` | Open a new dispute |
| \`respond(id, response_uri)\` | Submit a response as the defendant |
| \`cast_vote(id, in_favor)\` | Vote on a dispute (arbitrators only) |
| \`resolve(id)\` | Tally votes and finalize the outcome |
| \`get_dispute(id)\` | Retrieve dispute details |

## License

Apache-2.0`,
    dependencies: {
      "@polkadot/reputation": "3",
      "@polkadot/registries/users": "5",
    },
    versions: [
      { version: "3", date: "2025-09-14" },
      { version: "2", date: "2025-06-30" },
      { version: "1", date: "2025-03-05" },
    ],
  },
  {
    name: "@polkadot/dotns",
    version: "4",
    description:
      "Polkadot Name Service. Human-readable names to addresses, like ENS for the Polkadot ecosystem.",
    author: "Parity Technologies",
    weeklyCalls: 16300,
    license: "Apache-2.0",
    keywords: [
      "polkadot",
      "name-service",
      "dns",
      "dotns",
      "ens",
      "pvm",
      "smart-contract",
      "asset-hub",
    ],
    publishedDate: "2025-01-25",
    lastPublished: "4 weeks ago",
    repository: "https://github.com/paritytech/pvm-dotns",
    homepage: "https://docs.polkadot.com/contracts/dotns",
    readme: `# @polkadot/dotns

Polkadot Name Service (DotNS) \u2014 human-readable names to on-chain addresses. The naming layer for the Polkadot ecosystem, similar to ENS on Ethereum.

## Installation

\`\`\`bash
cdm add @polkadot/dotns
\`\`\`

## Overview

DotNS allows users to register \`.dot\` names that resolve to contract addresses, user addresses, or arbitrary records. Names are scoped within contexts provided by \`@polkadot/registries/contexts\`, enabling isolated namespaces for different environments.

Features:
- Register and manage \`.dot\` names
- Resolve names to addresses
- Set arbitrary text records (avatar, URL, description)
- Context-scoped resolution for multi-environment deployments

## Usage

\`\`\`rust
#![cfg_attr(not(feature = "std"), no_std, no_main)]

#[pvm::contract(cdm = "@polkadot/dotns")]
mod dotns {
    use pvm::prelude::*;

    #[derive(Debug, Clone, pvm::SolAbi)]
    pub struct NameRecord {
        pub name: String,
        pub owner: Address,
        pub resolved_address: Address,
        pub context: String,
        pub expires_at: u64,
    }

    #[pvm::storage]
    pub struct Storage {
        names: Mapping<(String, String), NameRecord>,
        records: Mapping<(String, String), String>,
        contexts: Lazy<cdm_reference!("@polkadot/registries/contexts")>,
    }

    #[pvm::method]
    fn register_name(
        &mut self,
        name: String,
        context: String,
        duration_days: u64,
    ) -> Result<(), Error> {
        let caller = pvm::caller();
        let contexts = self.contexts.get().unwrap();
        let ctx = contexts.get_context(context.clone()).expect("invalid context");
        assert!(ctx.active, "context is not active");

        let key = (name.clone(), context.clone());
        assert!(!self.names.contains(&key), "name already registered");

        let record = NameRecord {
            name,
            owner: caller,
            resolved_address: caller,
            context,
            expires_at: pvm::block_timestamp() + (duration_days * 86400),
        };

        self.names.insert(&key, &record);
        Ok(())
    }

    #[pvm::method]
    fn resolve(&self, name: String, context: String) -> Option<Address> {
        self.names.get(&(name, context)).map(|r| r.resolved_address)
    }

    #[pvm::method]
    fn set_address(
        &mut self,
        name: String,
        context: String,
        address: Address,
    ) -> Result<(), Error> {
        let caller = pvm::caller();
        let key = (name, context);
        let mut record = self.names.get(&key).expect("name not found");
        assert!(record.owner == caller, "not the owner");
        record.resolved_address = address;
        self.names.insert(&key, &record);
        Ok(())
    }

    #[pvm::method]
    fn set_text_record(
        &mut self,
        name: String,
        key: String,
        value: String,
    ) -> Result<(), Error> {
        self.records.insert(&(name, key), &value);
        Ok(())
    }
}
\`\`\`

## Examples

Resolve a name from another contract:

\`\`\`rust
let dotns = cdm_reference!("@polkadot/dotns");
let addr = dotns.resolve("alice.dot".into(), "production".into());
\`\`\`

## API Reference

| Method | Description |
|--------|-------------|
| \`register_name(name, context, days)\` | Register a \`.dot\` name |
| \`resolve(name, context)\` | Resolve a name to an address |
| \`set_address(name, context, addr)\` | Update the resolved address |
| \`set_text_record(name, key, value)\` | Set an arbitrary text record |
| \`transfer(name, context, new_owner)\` | Transfer name ownership |

## License

Apache-2.0`,
    dependencies: {
      "@polkadot/registries/contexts": "4",
    },
    versions: [
      { version: "4", date: "2025-10-22" },
      { version: "3", date: "2025-07-15" },
      { version: "2", date: "2025-04-08" },
      { version: "1", date: "2025-01-25" },
    ],
  },
  {
    name: "@polkadot/users/match-maker",
    version: "2",
    description:
      "Algorithmic user matching engine for Polkadot. Pairs users based on criteria, skills, and reputation scores.",
    author: "Parity Technologies",
    weeklyCalls: 5100,
    license: "Apache-2.0",
    keywords: [
      "polkadot",
      "matching",
      "users",
      "pairing",
      "skills",
      "pvm",
      "smart-contract",
    ],
    publishedDate: "2025-04-18",
    lastPublished: "2 months ago",
    repository: "https://github.com/paritytech/pvm-match-maker",
    homepage: "https://docs.polkadot.com/contracts/users/match-maker",
    readme: `# @polkadot/users/match-maker

Algorithmic user matching engine for the Polkadot contract ecosystem. Pairs users based on configurable criteria, skill tags, and on-chain reputation scores.

## Installation

\`\`\`bash
cdm add @polkadot/users/match-maker
\`\`\`

## Overview

The match-maker contract enables applications to pair users algorithmically. Users register their skills and preferences, and the matching algorithm considers reputation scores, skill overlap, and custom criteria to produce ranked match lists.

Depends on \`@polkadot/registries/users\` for identity and \`@polkadot/reputation\` for trust scoring.

## Usage

\`\`\`rust
#![cfg_attr(not(feature = "std"), no_std, no_main)]

#[pvm::contract(cdm = "@polkadot/users/match-maker")]
mod match_maker {
    use pvm::prelude::*;

    #[derive(Debug, Clone, pvm::SolAbi)]
    pub struct MatchProfile {
        pub user: Address,
        pub skills: Vec<String>,
        pub looking_for: Vec<String>,
        pub min_reputation: u64,
    }

    #[derive(Debug, Clone, pvm::SolAbi)]
    pub struct Match {
        pub user_a: Address,
        pub user_b: Address,
        pub compatibility_score: u64,
        pub matched_at: u64,
    }

    #[pvm::storage]
    pub struct Storage {
        profiles: Mapping<Address, MatchProfile>,
        matches: Mapping<Address, Vec<Match>>,
        users: Lazy<cdm_reference!("@polkadot/registries/users")>,
        reputation: Lazy<cdm_reference!("@polkadot/reputation")>,
    }

    #[pvm::method]
    fn register_match_profile(
        &mut self,
        skills: Vec<String>,
        looking_for: Vec<String>,
        min_reputation: u64,
    ) -> Result<(), Error> {
        let caller = pvm::caller();
        let users = self.users.get().unwrap();
        assert!(users.get_profile(caller).is_some(), "not registered");

        let profile = MatchProfile {
            user: caller,
            skills,
            looking_for,
            min_reputation,
        };
        self.profiles.insert(&caller, &profile);
        Ok(())
    }

    #[pvm::method]
    fn find_matches(&self, domain: String) -> Vec<Match> {
        let caller = pvm::caller();
        let profile = self.profiles.get(&caller).expect("no match profile");
        let reputation = self.reputation.get().unwrap();

        // Matching logic evaluates skill overlap and reputation thresholds
        // Returns ranked list of compatible users
        self.matches.get(&caller).unwrap_or_default()
    }

    #[pvm::method]
    fn get_match_profile(&self, user: Address) -> Option<MatchProfile> {
        self.profiles.get(&user)
    }
}
\`\`\`

## API Reference

| Method | Description |
|--------|-------------|
| \`register_match_profile(skills, looking_for, min_rep)\` | Create or update a match profile |
| \`find_matches(domain)\` | Find compatible users in a domain |
| \`get_match_profile(user)\` | Retrieve a user's match profile |
| \`confirm_match(match_id)\` | Confirm a proposed match |

## License

Apache-2.0`,
    dependencies: {
      "@polkadot/registries/users": "5",
      "@polkadot/reputation": "3",
    },
    versions: [
      { version: "2", date: "2025-08-25" },
      { version: "1", date: "2025-04-18" },
    ],
  },
  {
    name: "@polkadot/humanity/api",
    version: "3",
    description:
      "Proof of humanity verification for Polkadot. Sybil resistance through attestation chains and challenge-response protocols.",
    author: "Parity Technologies",
    weeklyCalls: 7400,
    license: "Apache-2.0",
    keywords: [
      "polkadot",
      "humanity",
      "sybil",
      "verification",
      "attestation",
      "proof-of-humanity",
      "pvm",
      "smart-contract",
    ],
    publishedDate: "2025-03-10",
    lastPublished: "3 months ago",
    repository: "https://github.com/paritytech/pvm-humanity",
    homepage: "https://docs.polkadot.com/contracts/humanity",
    readme: `# @polkadot/humanity/api

Proof of humanity verification for the Polkadot contract ecosystem. Provides sybil resistance through attestation chains, vouching, and challenge-response protocols.

## Installation

\`\`\`bash
cdm add @polkadot/humanity/api
\`\`\`

## Overview

The humanity contract establishes whether an on-chain address is controlled by a unique human. It uses a web-of-trust model where verified humans vouch for new applicants. Challenges can be raised against any verified address, triggering a review process.

Other contracts can gate functionality behind humanity verification to prevent bot abuse and sybil attacks.

Depends on \`@polkadot/registries/users\` for identity resolution.

## Usage

\`\`\`rust
#![cfg_attr(not(feature = "std"), no_std, no_main)]

#[pvm::contract(cdm = "@polkadot/humanity/api")]
mod humanity {
    use pvm::prelude::*;

    #[derive(Debug, Clone, pvm::SolAbi)]
    pub enum VerificationStatus {
        Unverified,
        Pending,
        Verified,
        Challenged,
    }

    #[derive(Debug, Clone, pvm::SolAbi)]
    pub struct HumanityRecord {
        pub address: Address,
        pub status: VerificationStatus,
        pub vouchers: Vec<Address>,
        pub verified_at: u64,
    }

    #[pvm::storage]
    pub struct Storage {
        records: Mapping<Address, HumanityRecord>,
        vouches_given: Mapping<Address, u64>,
        users: Lazy<cdm_reference!("@polkadot/registries/users")>,
    }

    #[pvm::method]
    fn apply(&mut self) -> Result<(), Error> {
        let caller = pvm::caller();
        let users = self.users.get().unwrap();
        assert!(users.get_profile(caller).is_some(), "must be registered");

        let record = HumanityRecord {
            address: caller,
            status: VerificationStatus::Pending,
            vouchers: Vec::new(),
            verified_at: 0,
        };
        self.records.insert(&caller, &record);
        Ok(())
    }

    #[pvm::method]
    fn vouch_for(&mut self, applicant: Address) -> Result<(), Error> {
        let caller = pvm::caller();
        let my_record = self.records.get(&caller).expect("not verified");
        assert!(
            matches!(my_record.status, VerificationStatus::Verified),
            "voucher must be verified"
        );

        let mut record = self.records.get(&applicant).expect("no application");
        record.vouchers.push(caller);

        // Auto-verify when threshold is reached
        if record.vouchers.len() >= 3 {
            record.status = VerificationStatus::Verified;
            record.verified_at = pvm::block_timestamp();
        }

        self.records.insert(&applicant, &record);
        Ok(())
    }

    #[pvm::method]
    fn is_human(&self, address: Address) -> bool {
        self.records
            .get(&address)
            .map(|r| matches!(r.status, VerificationStatus::Verified))
            .unwrap_or(false)
    }

    #[pvm::method]
    fn challenge(&mut self, target: Address, evidence_uri: String) -> Result<(), Error> {
        let mut record = self.records.get(&target).expect("not found");
        record.status = VerificationStatus::Challenged;
        self.records.insert(&target, &record);
        Ok(())
    }
}
\`\`\`

## Cross-Contract Integration

Gate any action behind humanity verification:

\`\`\`rust
let humanity = cdm_reference!("@polkadot/humanity/api");
assert!(humanity.is_human(caller), "proof of humanity required");
\`\`\`

## API Reference

| Method | Description |
|--------|-------------|
| \`apply()\` | Start the verification process |
| \`vouch_for(applicant)\` | Vouch for an applicant (verified users only) |
| \`is_human(address)\` | Check if an address is verified |
| \`challenge(target, evidence)\` | Challenge a verified address |
| \`get_record(address)\` | Get full humanity record |

## License

Apache-2.0`,
    dependencies: {
      "@polkadot/registries/users": "5",
    },
    versions: [
      { version: "3", date: "2025-09-05" },
      { version: "2", date: "2025-06-12" },
      { version: "1", date: "2025-03-10" },
    ],
  },
  {
    name: "@parity/gigs/api",
    version: "3",
    description:
      "Decentralized gig marketplace contract for Polkadot. Post gigs, bid, escrow payments, and rate completion.",
    author: "Parity Technologies",
    weeklyCalls: 6200,
    license: "Apache-2.0",
    keywords: [
      "polkadot",
      "gigs",
      "marketplace",
      "freelance",
      "escrow",
      "pvm",
      "smart-contract",
    ],
    publishedDate: "2025-04-01",
    lastPublished: "1 month ago",
    repository: "https://github.com/paritytech/pvm-gigs",
    homepage: "https://docs.polkadot.com/contracts/gigs",
    readme: `# @parity/gigs/api

Decentralized gig marketplace for the Polkadot contract ecosystem. Post gigs, accept bids, escrow payments, and rate completions \u2014 all on-chain with built-in dispute resolution.

## Installation

\`\`\`bash
cdm add @parity/gigs/api
\`\`\`

## Overview

The gigs contract enables a trustless freelance marketplace on Polkadot Asset Hub. Clients post gigs with requirements and budgets, freelancers bid, and funds are held in escrow until work is accepted. Integrated with the reputation system for trust and the disputes contract for conflict resolution.

Dependencies:
- \`@polkadot/reputation\` \u2014 for freelancer/client trust scores
- \`@polkadot/registries/users\` \u2014 for identity resolution
- \`@polkadot/disputes\` \u2014 for conflict resolution

## Usage

\`\`\`rust
#![cfg_attr(not(feature = "std"), no_std, no_main)]

#[pvm::contract(cdm = "@parity/gigs/api")]
mod gigs {
    use pvm::prelude::*;

    #[derive(Debug, Clone, pvm::SolAbi)]
    pub enum GigStatus {
        Open,
        Assigned,
        Submitted,
        Completed,
        Disputed,
    }

    #[derive(Debug, Clone, pvm::SolAbi)]
    pub struct Gig {
        pub id: u64,
        pub client: Address,
        pub freelancer: Option<Address>,
        pub title: String,
        pub description_uri: String,
        pub budget: U256,
        pub status: GigStatus,
        pub created_at: u64,
    }

    #[derive(Debug, Clone, pvm::SolAbi)]
    pub struct Bid {
        pub gig_id: u64,
        pub bidder: Address,
        pub amount: U256,
        pub proposal_uri: String,
    }

    #[pvm::storage]
    pub struct Storage {
        gigs: Mapping<u64, Gig>,
        bids: Mapping<u64, Vec<Bid>>,
        next_gig_id: Lazy<u64>,
        escrow: Mapping<u64, U256>,
        reputation: Lazy<cdm_reference!("@polkadot/reputation")>,
        users: Lazy<cdm_reference!("@polkadot/registries/users")>,
        disputes: Lazy<cdm_reference!("@polkadot/disputes")>,
    }

    #[pvm::method]
    fn post_gig(
        &mut self,
        title: String,
        description_uri: String,
    ) -> Result<u64, Error> {
        let caller = pvm::caller();
        let budget = pvm::transferred_value();
        let users = self.users.get().unwrap();
        assert!(users.get_profile(caller).is_some(), "not registered");

        let id = self.next_gig_id.get().unwrap_or(1);
        let gig = Gig {
            id,
            client: caller,
            freelancer: None,
            title,
            description_uri,
            budget,
            status: GigStatus::Open,
            created_at: pvm::block_timestamp(),
        };

        self.gigs.insert(&id, &gig);
        self.escrow.insert(&id, &budget);
        self.next_gig_id.set(&(id + 1));
        Ok(id)
    }

    #[pvm::method]
    fn place_bid(
        &mut self,
        gig_id: u64,
        amount: U256,
        proposal_uri: String,
    ) -> Result<(), Error> {
        let caller = pvm::caller();
        let bid = Bid {
            gig_id,
            bidder: caller,
            amount,
            proposal_uri,
        };
        let mut bids = self.bids.get(&gig_id).unwrap_or_default();
        bids.push(bid);
        self.bids.insert(&gig_id, &bids);
        Ok(())
    }

    #[pvm::method]
    fn accept_bid(&mut self, gig_id: u64, freelancer: Address) -> Result<(), Error> {
        let caller = pvm::caller();
        let mut gig = self.gigs.get(&gig_id).expect("gig not found");
        assert!(gig.client == caller, "not the client");
        gig.freelancer = Some(freelancer);
        gig.status = GigStatus::Assigned;
        self.gigs.insert(&gig_id, &gig);
        Ok(())
    }

    #[pvm::method]
    fn complete_gig(&mut self, gig_id: u64) -> Result<(), Error> {
        let caller = pvm::caller();
        let mut gig = self.gigs.get(&gig_id).expect("gig not found");
        assert!(gig.client == caller, "not the client");

        // Release escrow to freelancer
        let amount = self.escrow.get(&gig_id).unwrap();
        pvm::transfer(gig.freelancer.unwrap(), amount)?;

        // Update reputation
        let reputation = self.reputation.get().unwrap();
        reputation.endorse(gig.freelancer.unwrap(), "freelance".into())?;

        gig.status = GigStatus::Completed;
        self.gigs.insert(&gig_id, &gig);
        Ok(())
    }

    #[pvm::method]
    fn get_gig(&self, gig_id: u64) -> Option<Gig> {
        self.gigs.get(&gig_id)
    }
}
\`\`\`

## API Reference

| Method | Description |
|--------|-------------|
| \`post_gig(title, description_uri)\` | Post a new gig (attach payment as value) |
| \`place_bid(gig_id, amount, proposal_uri)\` | Bid on an open gig |
| \`accept_bid(gig_id, freelancer)\` | Accept a bid and assign the gig |
| \`submit_work(gig_id, delivery_uri)\` | Submit completed work |
| \`complete_gig(gig_id)\` | Approve work and release escrow |
| \`open_dispute(gig_id, evidence)\` | Escalate to dispute resolution |

## License

Apache-2.0`,
    dependencies: {
      "@polkadot/reputation": "3",
      "@polkadot/registries/users": "5",
      "@polkadot/disputes": "3",
    },
    versions: [
      { version: "3", date: "2025-10-10" },
      { version: "2", date: "2025-07-20" },
      { version: "1", date: "2025-04-01" },
    ],
  },
  {
    name: "@parity/hackm3/api",
    version: "2",
    description:
      "Hackathon platform contract for Polkadot. Create events, register teams, submit projects, and distribute prizes on-chain.",
    author: "Parity Technologies",
    weeklyCalls: 3800,
    license: "Apache-2.0",
    keywords: [
      "polkadot",
      "hackathon",
      "events",
      "prizes",
      "teams",
      "pvm",
      "smart-contract",
    ],
    publishedDate: "2025-05-15",
    lastPublished: "3 months ago",
    repository: "https://github.com/paritytech/pvm-hackm3",
    homepage: "https://docs.polkadot.com/contracts/hackm3",
    readme: `# @parity/hackm3/api

On-chain hackathon platform for the Polkadot ecosystem. Create hackathon events, register teams, submit projects, conduct judging, and distribute prizes \u2014 all transparently on Asset Hub.

## Installation

\`\`\`bash
cdm add @parity/hackm3/api
\`\`\`

## Overview

hackm3 brings hackathon coordination on-chain. Event organizers define tracks, prize pools, and deadlines. Teams register, build, and submit project deliverables. Judges score submissions and prizes are distributed automatically based on rankings.

Integrates with \`@polkadot/reputation\` so that hackathon performance feeds into participants' on-chain reputation, and \`@polkadot/registries/users\` for team member identity.

## Usage

\`\`\`rust
#![cfg_attr(not(feature = "std"), no_std, no_main)]

#[pvm::contract(cdm = "@parity/hackm3/api")]
mod hackm3 {
    use pvm::prelude::*;

    #[derive(Debug, Clone, pvm::SolAbi)]
    pub enum HackathonPhase {
        Registration,
        Building,
        Judging,
        Completed,
    }

    #[derive(Debug, Clone, pvm::SolAbi)]
    pub struct Hackathon {
        pub id: u64,
        pub organizer: Address,
        pub name: String,
        pub description_uri: String,
        pub prize_pool: U256,
        pub phase: HackathonPhase,
        pub registration_deadline: u64,
        pub submission_deadline: u64,
    }

    #[derive(Debug, Clone, pvm::SolAbi)]
    pub struct Team {
        pub id: u64,
        pub hackathon_id: u64,
        pub name: String,
        pub members: Vec<Address>,
        pub submission_uri: String,
        pub score: u64,
    }

    #[pvm::storage]
    pub struct Storage {
        hackathons: Mapping<u64, Hackathon>,
        teams: Mapping<u64, Team>,
        next_hackathon_id: Lazy<u64>,
        next_team_id: Lazy<u64>,
        reputation: Lazy<cdm_reference!("@polkadot/reputation")>,
        users: Lazy<cdm_reference!("@polkadot/registries/users")>,
    }

    #[pvm::method]
    fn create_hackathon(
        &mut self,
        name: String,
        description_uri: String,
        registration_deadline: u64,
        submission_deadline: u64,
    ) -> Result<u64, Error> {
        let caller = pvm::caller();
        let prize_pool = pvm::transferred_value();

        let id = self.next_hackathon_id.get().unwrap_or(1);
        let hackathon = Hackathon {
            id,
            organizer: caller,
            name,
            description_uri,
            prize_pool,
            phase: HackathonPhase::Registration,
            registration_deadline,
            submission_deadline,
        };

        self.hackathons.insert(&id, &hackathon);
        self.next_hackathon_id.set(&(id + 1));
        Ok(id)
    }

    #[pvm::method]
    fn register_team(
        &mut self,
        hackathon_id: u64,
        team_name: String,
        members: Vec<Address>,
    ) -> Result<u64, Error> {
        let users = self.users.get().unwrap();
        for member in &members {
            assert!(users.get_profile(*member).is_some(), "member not registered");
        }

        let id = self.next_team_id.get().unwrap_or(1);
        let team = Team {
            id,
            hackathon_id,
            name: team_name,
            members,
            submission_uri: String::new(),
            score: 0,
        };

        self.teams.insert(&id, &team);
        self.next_team_id.set(&(id + 1));
        Ok(id)
    }

    #[pvm::method]
    fn submit_project(
        &mut self,
        team_id: u64,
        submission_uri: String,
    ) -> Result<(), Error> {
        let mut team = self.teams.get(&team_id).expect("team not found");
        let hackathon = self.hackathons.get(&team.hackathon_id).expect("hackathon not found");
        assert!(
            pvm::block_timestamp() <= hackathon.submission_deadline,
            "submissions closed"
        );
        team.submission_uri = submission_uri;
        self.teams.insert(&team_id, &team);
        Ok(())
    }

    #[pvm::method]
    fn judge_submission(
        &mut self,
        team_id: u64,
        score: u64,
    ) -> Result<(), Error> {
        let caller = pvm::caller();
        let mut team = self.teams.get(&team_id).expect("team not found");
        let hackathon = self.hackathons.get(&team.hackathon_id).expect("not found");
        assert!(hackathon.organizer == caller, "not the organizer");
        team.score = score;
        self.teams.insert(&team_id, &team);
        Ok(())
    }

    #[pvm::method]
    fn get_hackathon(&self, id: u64) -> Option<Hackathon> {
        self.hackathons.get(&id)
    }
}
\`\`\`

## API Reference

| Method | Description |
|--------|-------------|
| \`create_hackathon(name, desc, reg_deadline, sub_deadline)\` | Create a new hackathon (attach prize pool as value) |
| \`register_team(hackathon_id, name, members)\` | Register a team for a hackathon |
| \`submit_project(team_id, submission_uri)\` | Submit a project deliverable |
| \`judge_submission(team_id, score)\` | Score a submission (organizer only) |
| \`distribute_prizes(hackathon_id)\` | Distribute prizes to top teams |
| \`get_hackathon(id)\` | Get hackathon details |

## License

Apache-2.0`,
    dependencies: {
      "@polkadot/reputation": "3",
      "@polkadot/registries/users": "5",
    },
    versions: [
      { version: "2", date: "2025-09-01" },
      { version: "1", date: "2025-05-15" },
    ],
  },
  {
    name: "@parity/mark3t/api",
    version: "3",
    description:
      "General marketplace contract for Polkadot. List items, make offers, escrow funds, and resolve disputes on-chain.",
    author: "Parity Technologies",
    weeklyCalls: 8100,
    license: "Apache-2.0",
    keywords: [
      "polkadot",
      "marketplace",
      "trading",
      "escrow",
      "offers",
      "pvm",
      "smart-contract",
    ],
    publishedDate: "2025-03-22",
    lastPublished: "2 weeks ago",
    repository: "https://github.com/paritytech/pvm-mark3t",
    homepage: "https://docs.polkadot.com/contracts/mark3t",
    readme: `# @parity/mark3t/api

General-purpose decentralized marketplace for the Polkadot ecosystem. List items, make offers, hold funds in escrow, and leverage on-chain dispute resolution \u2014 all on Asset Hub.

## Installation

\`\`\`bash
cdm add @parity/mark3t/api
\`\`\`

## Overview

mark3t provides a trustless marketplace primitive that any application can build upon. Sellers list items with descriptions and prices, buyers make offers or purchase at list price, and funds are held in escrow until the buyer confirms receipt. If a dispute arises, it is escalated to the \`@polkadot/disputes\` contract.

Seller and buyer reputation is tracked through \`@polkadot/reputation\`, and identities are resolved via \`@polkadot/registries/users\`.

## Usage

\`\`\`rust
#![cfg_attr(not(feature = "std"), no_std, no_main)]

#[pvm::contract(cdm = "@parity/mark3t/api")]
mod mark3t {
    use pvm::prelude::*;

    #[derive(Debug, Clone, pvm::SolAbi)]
    pub enum ListingStatus {
        Active,
        Sold,
        Escrowed,
        Disputed,
        Cancelled,
    }

    #[derive(Debug, Clone, pvm::SolAbi)]
    pub struct Listing {
        pub id: u64,
        pub seller: Address,
        pub title: String,
        pub description_uri: String,
        pub price: U256,
        pub status: ListingStatus,
        pub created_at: u64,
    }

    #[derive(Debug, Clone, pvm::SolAbi)]
    pub struct Offer {
        pub listing_id: u64,
        pub buyer: Address,
        pub amount: U256,
        pub message: String,
    }

    #[pvm::storage]
    pub struct Storage {
        listings: Mapping<u64, Listing>,
        offers: Mapping<u64, Vec<Offer>>,
        next_listing_id: Lazy<u64>,
        escrow: Mapping<u64, U256>,
        reputation: Lazy<cdm_reference!("@polkadot/reputation")>,
        users: Lazy<cdm_reference!("@polkadot/registries/users")>,
        disputes: Lazy<cdm_reference!("@polkadot/disputes")>,
    }

    #[pvm::method]
    fn create_listing(
        &mut self,
        title: String,
        description_uri: String,
        price: U256,
    ) -> Result<u64, Error> {
        let caller = pvm::caller();
        let users = self.users.get().unwrap();
        assert!(users.get_profile(caller).is_some(), "not registered");

        let id = self.next_listing_id.get().unwrap_or(1);
        let listing = Listing {
            id,
            seller: caller,
            title,
            description_uri,
            price,
            status: ListingStatus::Active,
            created_at: pvm::block_timestamp(),
        };

        self.listings.insert(&id, &listing);
        self.next_listing_id.set(&(id + 1));
        Ok(id)
    }

    #[pvm::method]
    fn purchase(&mut self, listing_id: u64) -> Result<(), Error> {
        let caller = pvm::caller();
        let value = pvm::transferred_value();
        let mut listing = self.listings.get(&listing_id).expect("not found");
        assert!(value >= listing.price, "insufficient payment");

        listing.status = ListingStatus::Escrowed;
        self.listings.insert(&listing_id, &listing);
        self.escrow.insert(&listing_id, &value);
        Ok(())
    }

    #[pvm::method]
    fn confirm_receipt(&mut self, listing_id: u64) -> Result<(), Error> {
        let mut listing = self.listings.get(&listing_id).expect("not found");
        let amount = self.escrow.get(&listing_id).unwrap();

        // Release funds to seller
        pvm::transfer(listing.seller, amount)?;

        // Endorse seller reputation
        let reputation = self.reputation.get().unwrap();
        reputation.endorse(listing.seller, "marketplace".into())?;

        listing.status = ListingStatus::Sold;
        self.listings.insert(&listing_id, &listing);
        Ok(())
    }

    #[pvm::method]
    fn open_dispute(&mut self, listing_id: u64, evidence_uri: String) -> Result<u64, Error> {
        let mut listing = self.listings.get(&listing_id).expect("not found");
        listing.status = ListingStatus::Disputed;
        self.listings.insert(&listing_id, &listing);

        let disputes = self.disputes.get().unwrap();
        let dispute_id = disputes.file_dispute(listing.seller, evidence_uri)?;
        Ok(dispute_id)
    }

    #[pvm::method]
    fn get_listing(&self, listing_id: u64) -> Option<Listing> {
        self.listings.get(&listing_id)
    }
}
\`\`\`

## API Reference

| Method | Description |
|--------|-------------|
| \`create_listing(title, desc_uri, price)\` | List an item for sale |
| \`purchase(listing_id)\` | Buy at list price (attach payment) |
| \`make_offer(listing_id, amount, msg)\` | Make an offer below list price |
| \`confirm_receipt(listing_id)\` | Confirm delivery and release escrow |
| \`open_dispute(listing_id, evidence)\` | Escalate to dispute resolution |
| \`get_listing(listing_id)\` | Get listing details |

## License

Apache-2.0`,
    dependencies: {
      "@polkadot/reputation": "3",
      "@polkadot/registries/users": "5",
      "@polkadot/disputes": "3",
    },
    versions: [
      { version: "3", date: "2025-11-10" },
      { version: "2", date: "2025-07-28" },
      { version: "1", date: "2025-03-22" },
    ],
  },
  {
    name: "@charles/counter",
    version: "3",
    description:
      "Simple counter example contract. Demonstrates basic PVM storage, increment/decrement, and cross-contract call patterns.",
    author: "Charles",
    weeklyCalls: 1200,
    license: "MIT",
    keywords: [
      "polkadot",
      "counter",
      "example",
      "tutorial",
      "pvm",
      "smart-contract",
      "beginner",
    ],
    publishedDate: "2025-06-10",
    lastPublished: "4 months ago",
    repository: "https://github.com/charlesdev/pvm-counter",
    homepage: "https://docs.polkadot.com/tutorials/counter",
    readme: `# @charles/counter

A simple counter contract for Polkadot Asset Hub. A minimal example demonstrating PVM contract basics: storage, methods, events, and cross-contract patterns.

## Installation

\`\`\`bash
cdm add @charles/counter
\`\`\`

## Overview

This is a beginner-friendly example contract that implements a simple counter with increment, decrement, and reset functionality. It serves as a starting point for learning \`cargo-pvm-contract\` development and the CDM toolchain.

## Usage

\`\`\`rust
#![cfg_attr(not(feature = "std"), no_std, no_main)]

#[pvm::contract(cdm = "@charles/counter")]
mod counter {
    use pvm::prelude::*;

    #[pvm::storage]
    pub struct Storage {
        value: Lazy<u64>,
        owner: Lazy<Address>,
        step: Lazy<u64>,
    }

    #[pvm::event]
    pub enum Event {
        Incremented { value: u64 },
        Decremented { value: u64 },
        Reset { by: Address },
    }

    #[pvm::constructor]
    fn new(&mut self, initial_value: u64, step: u64) {
        self.value.set(&initial_value);
        self.owner.set(&pvm::caller());
        self.step.set(&step);
    }

    #[pvm::method]
    fn increment(&mut self) -> u64 {
        let step = self.step.get().unwrap_or(1);
        let current = self.value.get().unwrap_or(0);
        let new_value = current + step;
        self.value.set(&new_value);

        pvm::emit_event(Event::Incremented { value: new_value });
        new_value
    }

    #[pvm::method]
    fn decrement(&mut self) -> u64 {
        let step = self.step.get().unwrap_or(1);
        let current = self.value.get().unwrap_or(0);
        let new_value = current.saturating_sub(step);
        self.value.set(&new_value);

        pvm::emit_event(Event::Decremented { value: new_value });
        new_value
    }

    #[pvm::method]
    fn get(&self) -> u64 {
        self.value.get().unwrap_or(0)
    }

    #[pvm::method]
    fn reset(&mut self) -> Result<(), Error> {
        let caller = pvm::caller();
        assert!(caller == self.owner.get().unwrap(), "only owner can reset");
        self.value.set(&0);
        pvm::emit_event(Event::Reset { by: caller });
        Ok(())
    }

    #[pvm::method]
    fn set_step(&mut self, new_step: u64) -> Result<(), Error> {
        let caller = pvm::caller();
        assert!(caller == self.owner.get().unwrap(), "only owner");
        self.step.set(&new_step);
        Ok(())
    }
}
\`\`\`

## Deploying

\`\`\`bash
cdm build
cdm deploy --network asset-hub
\`\`\`

## Calling from Another Contract

You can reference the counter from any other PVM contract:

\`\`\`rust
let counter = cdm_reference!("@charles/counter");
let current = counter.get();
counter.increment();
\`\`\`

## API Reference

| Method | Description |
|--------|-------------|
| \`new(initial_value, step)\` | Initialize the counter |
| \`increment()\` | Increase the counter by step |
| \`decrement()\` | Decrease the counter by step |
| \`get()\` | Read the current value |
| \`reset()\` | Reset to zero (owner only) |
| \`set_step(new_step)\` | Change the step size (owner only) |

## License

MIT`,
    dependencies: {},
    versions: [
      { version: "3", date: "2025-09-18" },
      { version: "2", date: "2025-08-02" },
      { version: "1", date: "2025-06-10" },
    ],
  },
];
