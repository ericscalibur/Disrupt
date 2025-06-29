# Authentication Debugging Guide for Disrupt Portal

## Overview
This guide helps debug authentication issues where users experience errors that are fixed by refreshing the page. The main causes are typically JWT token expiration, race conditions, and session management issues.

## Common Symptoms
- Users get authentication errors that disappear after refreshing
- "Invalid or expired token" messages
- Dashboard loads but API calls fail
- Users get logged out unexpectedly

## Debug Steps

### 1. Check Browser Console
Open browser developer tools (F12) and look for:
```
JWT verification error: TokenExpiredError
Error during token refresh: [error details]
Authentication failed: [reason]
Network error during fetch: [error details]
```

### 2. Monitor Network Tab
In the Network tab, watch for:
- 401 responses from API endpoints
- Failed `/api/refresh` requests
- Missing Authorization headers
- CORS errors

### 3. Check Session Storage
In Application tab > Session Storage, verify:
- `token` exists and is not expired
- `user` object is properly stored
- Token payload can be decoded (use jwt.io)

### 4. Server-Side Logging
Check server console for:
```
Authentication failed: No authorization header
JWT verification error: TokenExpiredError
Refresh failed: Invalid refresh token
Token refreshed successfully for user: [email]
Refresh token removed on logout
```

## Debugging Commands

### Check Token Expiration (Browser Console)
```javascript
// Check if current token is expired
function checkToken() {
  const token = sessionStorage.getItem('token');
  if (!token) return 'No token found';
  
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    const now = Math.floor(Date.now() / 1000);
    const expiresIn = payload.exp - now;
    
    return {
      expires: new Date(payload.exp * 1000),
      expiresInSeconds: expiresIn,
      isExpired: expiresIn <= 0,
      user: payload.email,
      role: payload.role
    };
  } catch (e) {
    return 'Invalid token format';
  }
}

console.log(checkToken());
```

### Force Token Refresh (Browser Console)
```javascript
// Manually trigger token refresh
async function forceRefresh() {
  try {
    const response = await fetch('/api/refresh', {
      method: 'POST',
      credentials: 'include'
    });
    const data = await response.json();
    if (data.accessToken) {
      sessionStorage.setItem('token', data.accessToken);
      console.log('Token refreshed successfully');
      return checkToken();
    }
  } catch (e) {
    console.error('Refresh failed:', e);
  }
}

forceRefresh();
```

### Check Refresh Token Status (Server)
```bash
# Check if refresh tokens file exists and contains data
cat data/refresh_tokens.json | jq length
```

## Common Issues and Solutions

### Issue 1: Token Expires During Page Session
**Symptoms:** Works initially, then fails after 15 minutes
**Solution:** The proactive token refresh should handle this automatically. Check if `scheduleTokenRefresh` is working.

### Issue 2: Race Condition During Multiple API Calls
**Symptoms:** Multiple refresh attempts, inconsistent failures
**Solution:** The new `isRefreshing` flag prevents concurrent refreshes.

### Issue 3: Server Restart Loses Refresh Tokens
**Symptoms:** All users get logged out after server restart
**Solution:** Refresh tokens are now persisted to `data/refresh_tokens.json`

### Issue 4: Browser Tab Switching Issues
**Symptoms:** Errors when switching between tabs
**Solution:** Use `sessionStorage` (current) or switch to `localStorage` for cross-tab persistence

## Monitoring and Alerts

### Key Metrics to Track
1. Token refresh success rate
2. Authentication failure rate
3. Average session duration
4. Refresh token storage size

### Log Analysis Queries
```bash
# Count authentication failures
grep "Authentication failed" server.log | wc -l

# Count successful token refreshes
grep "Token refreshed successfully" server.log | wc -l

# Find users with frequent refresh failures
grep "Refresh failed" server.log | grep -o 'user: [^"]*' | sort | uniq -c
```

## Configuration Recommendations

### Production Settings
```javascript
// Recommended token lifetimes
ACCESS_TOKEN_LIFETIME = "15m"  // 15 minutes
REFRESH_TOKEN_LIFETIME = "7d"  // 7 days

// Cookie settings for production
cookieOptions = {
  httpOnly: true,
  secure: true,           // HTTPS only
  sameSite: "Strict",
  maxAge: 7 * 24 * 60 * 60 * 1000
}
```

### Development Settings
```javascript
// Extended lifetimes for development
ACCESS_TOKEN_LIFETIME = "1h"   // 1 hour
REFRESH_TOKEN_LIFETIME = "30d" // 30 days

// Relaxed cookie settings
cookieOptions = {
  httpOnly: true,
  secure: false,          // Allow HTTP in development
  sameSite: "Lax",
  maxAge: 30 * 24 * 60 * 60 * 1000
}
```

## Emergency Fixes

### Quick Fix 1: Clear All Sessions
```bash
# Remove all stored refresh tokens (logs everyone out)
rm data/refresh_tokens.json
# Or empty the file
echo "[]" > data/refresh_tokens.json
```

### Quick Fix 2: Increase Token Lifetime Temporarily
```bash
# In .env file, increase access token lifetime
ACCESS_TOKEN_SECRET="your-secret"
REFRESH_TOKEN_SECRET="your-refresh-secret"

# Restart server after changing
```

### Quick Fix 3: Client-Side Reset
```javascript
// Clear all client-side auth data
sessionStorage.clear();
localStorage.clear();
// Clear cookies
document.cookie.split(";").forEach(c => {
  document.cookie = c.replace(/^ +/, "").replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/");
});
location.reload();
```

## Testing Scenarios

### Test 1: Token Expiration
1. Login and note token expiration time
2. Wait for token to expire (or manually set system time forward)
3. Make an API call - should auto-refresh
4. Verify new token has later expiration

### Test 2: Concurrent Requests
1. Login
2. Open browser console
3. Execute multiple API calls simultaneously:
```javascript
Promise.all([
  fetch('/api/users', {headers: {Authorization: `Bearer ${sessionStorage.getItem('token')}`}}),
  fetch('/api/departments', {headers: {Authorization: `Bearer ${sessionStorage.getItem('token')}`}}),
  fetch('/api/drafts', {headers: {Authorization: `Bearer ${sessionStorage.getItem('token')}`}})
]);
```

### Test 3: Server Restart
1. Login and perform actions
2. Restart server
3. Try to perform actions - should still work with persisted refresh tokens

## Performance Considerations

- Refresh tokens are stored in memory + file (fast access)
- Token refresh is lazy (on-demand) + proactive (scheduled)
- Failed refresh attempts are logged but don't block the UI
- Multiple tabs share session storage (consistent state)

## Security Notes

- Refresh tokens are HTTP-only cookies (XSS protection)
- Access tokens are short-lived (15 minutes)
- Refresh tokens rotate on use (prevents replay attacks)
- Failed attempts are logged for monitoring
- Tokens are cleared on explicit logout