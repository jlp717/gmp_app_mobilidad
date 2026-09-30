'use strict';

const mockQuery = jest.fn(async () => [{ VENDOR_CODE: '05' }]);
jest.mock('../config/db', () => ({
    query: (...args) => mockQuery(...args),
    queryWithParams: (...args) => mockQuery(...args),
}));

const { lookupClientAssignedVendorCodes } = require('../utils/common');

test('assigned-vendor lookup compares the caller code without throwing', async () => {
    const codes = await lookupClientAssignedVendorCodes('4300007540', ['05']);
    expect(codes).toEqual(['05']);
    expect(mockQuery).toHaveBeenCalledTimes(1);
});
