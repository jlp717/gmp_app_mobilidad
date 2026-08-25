'use strict';

/**
 * Seam unico de configuracion runtime para las capas src/.
 * Los repositories importan desde aqui; nunca un service/controller.
 */
module.exports = {
    db: require('../../config/db'),
};
