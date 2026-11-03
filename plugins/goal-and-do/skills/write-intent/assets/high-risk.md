# High-risk changes

Intent checks the request against this list. It writes each item the change touches into the `high-risk:` line of `intent.md`'s front matter, or `none`, and one open question per item touched, starting with the item's words and a colon. Intent can't be approved until each of these questions has an answer; "Not known yet" doesn't count. A project may add lines in `.claude/intent/high-risk.md`; it may not remove any.

- Authentication or authorization
- Money: payments, pricing, premiums, claims amounts
- Personal data
- Cryptography or key handling
- Data migration or schema changes
- Anything facing production directly
