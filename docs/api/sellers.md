# B03 seller onboarding and approval

All routes are under `/api/v1` and use the standard JSON envelope.

| Method and route | Authentication | Current behavior |
|---|---|---|
| `POST /sellers` | Verified bearer user | Create one seller profile for the current account and grant the `seller` role. |
| `GET /sellers/me` | Bearer user | Read only the current account's seller profile. |
| `POST /sellers/me/verification` | Bearer seller | Returns `503 IDENTITY_PROVIDER_NOT_CONFIGURED` while Dojah and consent are deferred; suspended sellers receive `403`. |
| `PATCH /admin/sellers/:sellerId/status` | Admin bearer user | Set `pending`, `approved`, or `suspended` with an audit reason. Self-decisions are forbidden. Approval requires `identityStatus=verified`. |

Create a seller with:

```json
{
  "businessName": "Synthetic Hair Store",
  "phone": "+2348000000000"
}
```

Admin status decisions require:

```json
{
  "status": "suspended",
  "reason": "Synthetic compliance hold"
}
```

Identity status (`not_started`, `pending`, `verified`, `failed`, `manual_review`) is distinct from approval status (`pending`, `approved`, `suspended`). No current API changes identity status. The Dojah check, provider contract, consent text, consent records, callback authentication, and provider acceptance tests are explicitly deferred and must not be inferred from the placeholder verification route.
