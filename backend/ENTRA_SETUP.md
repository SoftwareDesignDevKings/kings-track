# Entra ID Setup Checklist

## Azure Portal

1. **Create an App Registration** (Azure AD > App registrations > New)
   - Single tenant, restricted to `kings.edu.au`
   - Platform: **Single-page application (SPA)**
   - Redirect URI: `http://localhost:5173` (add production URL later)

2. **API Permissions** — add these delegated permissions:
   - `openid`
   - `profile`
   - `email`

3. **Token Configuration** — add a groups claim:
   - Go to Token configuration > Add groups claim
   - Select **Security groups**
   - Emit as **Group ID**

4. **Create two Security Groups** (Azure AD > Groups):
   - `CST-Admins` — add admin staff as members
   - `CST-Teachers` — add teaching staff as members

## Values You Need

| Value | Where to find it | Env var |
|---|---|---|
| Tenant ID | App registration > Overview | `ENTRA_TENANT_ID` |
| Client ID (Application ID) | App registration > Overview | `ENTRA_CLIENT_ID` |
| CST-Admins group Object ID | Azure AD > Groups > CST-Admins > Overview | `ENTRA_ADMIN_GROUP_ID` |
| CST-Teachers group Object ID | Azure AD > Groups > CST-Teachers > Overview | `ENTRA_TEACHER_GROUP_ID` |

## .env

```env
AUTH_MODE=entra
ENTRA_TENANT_ID=<tenant-id>
ENTRA_CLIENT_ID=<client-id>
ENTRA_ADMIN_GROUP_ID=<cst-admins-object-id>
ENTRA_TEACHER_GROUP_ID=<cst-teachers-object-id>
```

## Verify

```bash
# 1. Get a token (browser or Azure CLI)
az account get-access-token --resource <client-id>

# 2. Test token decoding (no DB lookup)
curl -H "Authorization: Bearer <token>" http://localhost:8000/api/auth/entra-debug

# 3. Test full login (auto-creates user in app_users)
curl -H "Authorization: Bearer <token>" http://localhost:8000/api/auth/me
```
