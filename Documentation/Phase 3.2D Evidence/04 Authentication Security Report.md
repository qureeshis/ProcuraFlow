# Authentication Security

| Group | Test | Status | Evidence |
|---|---|---|---|
| Authentication | Valid login | PASS | {"token":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MTUsInVzZXJuYW1lIjoidDMyZFZhbGlkMTc4NjU3NzcxOTc3NSIsInJvbGUiOiJQdXJjaGFzZU1hbmFnZXIiLCJmdWxsX25hbWUiOiJQaGFzZTMyRCBWYWxpZCIsI |
| Authentication | Invalid password | PASS | {"error":"Invalid username or password"} |
| Authentication | Invalid token | PASS | {"error":"Invalid or expired token"} |
| Authentication | Expired token | PASS | {"error":"Invalid or expired token"} |
| Authentication | Malformed token | PASS | {"error":"Invalid or expired token"} |
| Authentication | Inactive user | PASS | {"error":"Account is inactive or no longer available"} |
| Authentication | Disabled employee | PASS | {"error":"This employee has no ProcuraFlow system access"} |
| Authentication | Nonexistent user token | PASS | {"error":"Account is inactive or no longer available"} |
| Authentication | Nonexistent login | PASS | {"error":"Invalid username or password"} |
| Authentication | Password expiry | PASS | {"error":"Password expired. Contact the Supply Chain Manager to restore access."} |
