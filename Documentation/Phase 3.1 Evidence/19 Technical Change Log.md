# Phase 3.1 Technical Change Log

- Added authoritative PO and Material Issue authorization-limit records and management APIs.
- Removed creator auto-approval of POs and routed independent approval by value tier.
- Added Purchase Officer approval within inclusive employee limit and backend bypass protection.
- Added Storekeeper employee/warehouse issue limits, quantity/category scopes, over-limit routing, and historical limit evidence.
- Added action permissions for PO, GRN, issue, vendor, and adjustment risk separation.
- Reclassified approved operational rules separately in the SoD report.
- Added atomic PO approval/rejection transitions.
- Added isolated 10-case HTTP limit suite.
- Preserved historical ledger and SoD decisions without fabrication.