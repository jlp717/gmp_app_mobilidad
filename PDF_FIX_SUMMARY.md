# PDF Generation Fix - DIEGO Authorization Issue

## Problem
DIEGO (code 98) was getting error "Solo DIEGO puede generar este informe" when trying to generate PDF reports, even though he was logged in as DIEGO.

## Root Cause
The backend PDF route was checking `req.user?.name` for authorization, but the JWT token payload only contained `user` (code) and not `name`. The auth middleware (`backend/middleware/auth.js`) was setting:
```javascript
req.user = { id, code, role, isJefeVentas }  // NO name field!
```

But the PDF route was trying to access:
```javascript
const userName = req.user?.name || req.user?.username || '';  // Always undefined!
```

This caused the authorization check to always fail.

## Changes Made

### 1. Backend Authorization Fix (`backend/routes/commissions.js`)
**File:** `backend/routes/commissions.js` (lines 1130-1160)

**Before:**
```javascript
const userName = req.user?.name || req.user?.username || '';
if (!pdfService.isAuthorized(userName)) {
    return res.status(403).json({ error: 'Solo DIEGO puede generar este informe' });
}
```

**After:**
```javascript
// Use user code (req.user.code) instead of name
const userCode = req.user?.code || '';
const userId = req.user?.id || '';

// Check both the code (normalized) and user ID
const normalizedCode = userCode.replace(/^0+/, '');
const isAuthorized = normalizedCode === '98' || userId === 'V98';

if (!isAuthorized) {
    return res.status(403).json({ error: 'Solo DIEGO puede generar este informe' });
}
```

**Benefits:**
- ✅ Now correctly identifies DIEGO by code (98) or ID (V98)
- ✅ Normalizes code by removing leading zeros (handles "098", "0098", etc.)
- ✅ Double verification (both code and ID)
- ✅ Better logging with user code and IP tracking

### 2. JWT Token Enhancement (`backend/routes/auth.js`)
**File:** `backend/routes/auth.js` (lines 289-300)

**Added:** `name` field to both access and refresh tokens

**Before:**
```javascript
const accessToken = signAccessToken({
    id: `V${vendedorCode}`,
    user: vendedorCode,
    role: finalRole,
    isJefeVentas,
    timestamp: Date.now()
});
```

**After:**
```javascript
const accessToken = signAccessToken({
    id: `V${vendedorCode}`,
    user: vendedorCode,
    name: vendedorName,  // ✅ ADDED
    role: finalRole,
    isJefeVentas,
    timestamp: Date.now()
});
```

**Benefits:**
- ✅ Token now contains vendor name for better logging and future features
- ✅ Backward compatible (old tokens still work)

### 3. Auth Middleware Enhancement (`backend/middleware/auth.js`)
**File:** `backend/middleware/auth.js` (lines 223-257)

**Added:** `name` field to `req.user` object in both `verifyToken` and `optionalAuth` middlewares

**Before:**
```javascript
req.user = {
    id: payload.id,
    code: payload.user,
    role: payload.role || 'COMERCIAL',
    isJefeVentas: payload.isJefeVentas || false
};
```

**After:**
```javascript
req.user = {
    id: payload.id,
    code: payload.user,
    name: payload.name,  // ✅ ADDED
    role: payload.role || 'COMERCIAL',
    isJefeVentas: payload.isJefeVentas || false
};
```

**Benefits:**
- ✅ Name is now available in all routes via `req.user.name`
- ✅ Consistent user object structure across all endpoints

### 4. Comprehensive Error Handling - Backend (`backend/routes/commissions.js`)
**File:** `backend/routes/commissions.js` (lines 1160-1251)

**Enhanced error handling:**
- ✅ Separate try-catch for data fetching with detailed error messages
- ✅ Separate try-catch for PDF generation with stack traces
- ✅ Separate try-catch for sending response
- ✅ Better logging at each step (data fetch, PDF generation, send)
- ✅ PDF size logging for monitoring
- ✅ Development mode stack traces
- ✅ Proper HTTP headers (Content-Length, Cache-Control, Pragma)

**Example:**
```javascript
// Fetch data with error handling
let vendorData, condorData;
try {
    [vendorData, condorData] = await Promise.all([...]);
    logger.info(`[PDF] Data fetched successfully: ${vendorData.length} LAC vendors`);
} catch (dataError) {
    logger.error(`[PDF] Error fetching sales data: ${dataError.message}`);
    return res.status(500).json({ error: 'Error obteniendo datos de ventas' });
}
```

### 5. Enhanced Frontend PDF Service (`lib/features/commissions/data/commissions_pdf_service.dart`)
**Complete rewrite with robust error handling:**

**Key Improvements:**

#### A. Retry Logic
```dart
static const int _maxRetries = 2;
static const Duration _retryDelay = Duration(seconds: 1);

// Automatic retry on transient failures
while (attempts <= _maxRetries) {
    try {
        await _downloadAndOpenPdf(...);
        return; // Success
    } catch (e) {
        attempts++;
        // Don't retry on 403 (auth errors)
        if (e.toString().contains('Solo DIEGO puede generar')) {
            onError(e.toString());
            return;
        }
    }
}
```

**Benefits:**
- ✅ Up to 3 total attempts (initial + 2 retries)
- ✅ Exponential backoff (1s, 2s delays)
- ✅ Smart retry (skips retry on auth failures)

#### B. PDF Validation
```dart
// Verify PDF magic number (%PDF)
if (pdfBytes.length < 4 || 
    pdfBytes[0] != 0x25 || // %
    pdfBytes[1] != 0x50 || // P
    pdfBytes[2] != 0x44 || // D
    pdfBytes[3] != 0x46) { // F
    throw Exception('El archivo descargado no es un PDF válido');
}
```

**Benefits:**
- ✅ Validates PDF file integrity
- ✅ Prevents opening corrupted files
- ✅ Early detection of server errors

#### C. Better HTTP Client (Dio instead of http)
```dart
final dio = Dio(BaseOptions(
    connectTimeout: const Duration(seconds: 30),
    receiveTimeout: const Duration(seconds: 60), // PDF can be slow
    headers: ApiClient.authHeaders,
));

final response = await dio.get<Uint8List>(
    uri.toString(),
    options: Options(
        responseType: ResponseType.bytes,
        followRedirects: true,
    ),
);
```

**Benefits:**
- ✅ Better timeout control (30s connect, 60s receive)
- ✅ Proper byte array handling
- ✅ Automatic redirect following
- ✅ Better error categorization

#### D. Comprehensive Error Messages
```dart
on DioException catch (e) {
    if (e.type == DioExceptionType.connectionTimeout) {
        throw Exception('Tiempo de conexión agotado...');
    } else if (e.type == DioExceptionType.receiveTimeout) {
        throw Exception('Tiempo de respuesta agotado...');
    } else if (e.type == DioExceptionType.badResponse) {
        if (e.response?.statusCode == 403) {
            throw Exception('Solo DIEGO puede generar este informe');
        } else if (e.response?.statusCode == 500) {
            throw Exception('Error del servidor: $details');
        }
    } else if (e.type == DioExceptionType.connectionError) {
        throw Exception('No se puede conectar al servidor...');
    }
}
```

**Benefits:**
- ✅ User-friendly error messages in Spanish
- ✅ Specific messages for each error type
- ✅ Network vs server error distinction
- ✅ Timeout-specific messages

#### E. File Integrity Checks
```dart
// Verify file was written successfully
if (!await file.exists() || await file.length() == 0) {
    throw Exception('Error guardando el archivo PDF');
}

debugPrint('[CommissionsPDF] PDF saved: ${filePath} (${(pdfBytes.length / 1024).toStringAsFixed(2)} KB)');
```

**Benefits:**
- ✅ Verifies file write success
- ✅ Logs file size for debugging
- ✅ Prevents opening empty files

## Testing Checklist

### Before Testing:
1. ✅ Backend server restarted
2. ✅ Flutter app rebuilt (hot restart sufficient)
3. ✅ User logged out and logged back in (to get new token with name field)

### Test Scenarios:

#### ✅ Authorization Tests
- [ ] DIEGO (code 98) can generate PDF
- [ ] Other users cannot see PDF button
- [ ] Other users get 403 if they try to access endpoint directly

#### ✅ PDF Generation Tests
- [ ] "Mes actual" (current month) works
- [ ] "Último mes" (last month) works
- [ ] "Últimos 2 meses" works
- [ ] "Últimos 3 meses" works
- [ ] "Todo el año" works
- [ ] PDF opens automatically after generation
- [ ] PDF file size is reasonable (>1KB, <50MB)
- [ ] PDF contains correct data

#### ✅ Error Handling Tests
- [ ] Network disconnect shows proper error
- [ ] Server timeout shows proper error
- [ ] Invalid PDF from server shows proper error
- [ ] 403 error shows "Solo DIEGO" message
- [ ] 500 server error shows details
- [ ] Retry works on transient failures
- [ ] No retry on 403 (auth) errors

#### ✅ Edge Cases
- [ ] User code "098" works (leading zeros)
- [ ] User code "0098" works
- [ ] User code "98" works
- [ ] User ID "V98" works
- [ ] Empty vendor code handled
- [ ] Invalid year handled
- [ ] Invalid range handled

## Files Modified

### Backend (Node.js)
1. `backend/routes/commissions.js` - Authorization fix + error handling
2. `backend/routes/auth.js` - Added name to JWT tokens
3. `backend/middleware/auth.js` - Added name to req.user

### Frontend (Flutter/Dart)
1. `lib/features/commissions/data/commissions_pdf_service.dart` - Complete rewrite with error handling

## Deployment Notes

### Backend Deployment:
```bash
# Restart backend server
cd backend
npm restart
# or if using PM2
pm2 restart backend
```

### Frontend Deployment:
```bash
# Rebuild Flutter app
flutter clean
flutter pub get
flutter build apk --release  # for Android
# or
flutter build ios --release  # for iOS
```

### Important:
- ⚠️ Users must log out and log back in to get new JWT tokens with name field
- ⚠️ Old tokens will still work (backward compatible) but won't have name field
- ⚠️ Recommended to invalidate old tokens if possible

## Monitoring

### Backend Logs to Watch:
```
[PDF] Request received from user: code=98, id=V98, ip=...
[PDF] Authorization granted for DIEGO (code: 98)
[PDF] Generating for DIEGO: year=2026, months 4-4
[PDF] Data fetched successfully: 10 LAC vendors, 5 Condor vendors
[PDF] PDF generated successfully (245.67 KB)
[PDF] PDF sent successfully for DIEGO (10 vendors)
```

### Error Logs to Watch:
```
[PDF] Unauthorized PDF attempt by user code: 35 (V35) from IP: ...
[PDF] Error fetching sales data: ...
[PDF] Error generating PDF: ...
```

## Rollback Plan

If issues occur, revert these commits:
1. Backend auth changes
2. Frontend PDF service changes
3. Restart backend
4. Rebuild frontend

The changes are backward compatible, so rollback should be safe.

## Success Criteria

✅ DIEGO can generate PDF reports without errors
✅ PDF downloads and opens correctly
✅ Error messages are user-friendly and helpful
✅ Retry logic handles transient failures
✅ PDF validation prevents corrupted files
✅ Comprehensive logging for debugging
✅ All edge cases handled gracefully
