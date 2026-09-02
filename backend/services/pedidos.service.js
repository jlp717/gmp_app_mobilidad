'use strict';

const search = require('./pedidos/search');
const catalog = require('./pedidos/catalog');
const write = require('./pedidos/write');
const analytics = require('./pedidos/analytics');
const shared = require('./pedidos/shared');

module.exports = {
    ...search,
    ...catalog,
    ...write,
    ...analytics,
    ...shared,
};
