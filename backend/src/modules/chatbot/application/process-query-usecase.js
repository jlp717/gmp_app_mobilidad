/**
 * Process Query Use Case - Chatbot Domain
 */
const { UseCase } = require('../../../core/application/use-case');

class ProcessQueryUseCase extends UseCase {
  constructor(chatbotRepository) {
    super();
    this._repository = chatbotRepository;
  }

  async execute({ userId, message }) {
    if (!userId || !message) {
      throw new ValidationError('userId and message are required');
    }

    let session = await this._repository.getSession(userId);
    if (!session) {
      session = await this._repository.createSession(userId);
    }

    await this._repository.saveMessage(session.id, { role: 'user', content: message });

    const response = await this._processMessage(message);

    await this._repository.saveMessage(session.id, { role: 'assistant', content: response.text });

    return {
      sessionId: session.id,
      response: response.text,
      data: response.data || null,
      type: response.type
    };
  }

  async _processMessage(message) {
    const lower = message.toLowerCase().trim();

    if (lower.startsWith('cliente ') || lower.startsWith('client ')) {
      const code = message.split(' ')[1];
      if (code) {
        const client = await this._repository.lookupClient(code);
        if (client) {
          return {
            type: 'client',
            text: `Cliente: ${client.NOMBRE} (${client.CODIGO})\nDirección: ${client.DIRECCION}\nLocalidad: ${client.POBLACION}, ${client.PROVINCIA}`,
            data: client
          };
        }
        return { type: 'error', text: `No se encontró el cliente con código ${code}` };
      }
    }

    if (lower.startsWith('producto ') || lower.startsWith('product ') || lower.startsWith('articulo ')) {
      const code = message.split(' ')[1];
      if (code) {
        const product = await this._repository.lookupProduct(code);
        if (product) {
          return {
            type: 'product',
            text: `Producto: ${product.NOMBRE} (${product.CODIGO})\nFamilia: ${product.FAMILIA}\nPrecio: ${product.PRECIO}`,
            data: product
          };
        }
        return { type: 'error', text: `No se encontró el producto con código ${code}` };
      }
    }

    if (lower.startsWith('buscar cliente ') || lower.startsWith('buscar client ')) {
      const query = message.substring(lower.indexOf('cliente ') + 8);
      const results = await this._repository.searchClients(query);
      if (results && results.length > 0) {
        const list = results.map(r => `- ${r.NOMBRE} (${r.CODIGO}) - ${r.POBLACION}`).join('\n');
        return { type: 'client_search', text: `Resultados:\n${list}`, data: results };
      }
      return { type: 'error', text: 'No se encontraron clientes con ese criterio' };
    }

    if (lower.startsWith('buscar producto ') || lower.startsWith('buscar product ')) {
      const query = message.substring(lower.indexOf('producto ') + 9);
      const results = await this._repository.searchProducts(query);
      if (results && results.length > 0) {
        const list = results.map(r => `- ${r.NOMBRE} (${r.CODIGO})`).join('\n');
        return { type: 'product_search', text: `Resultados:\n${list}`, data: results };
      }
      return { type: 'error', text: 'No se encontraron productos con ese criterio' };
    }

    return {
      type: 'help',
      text: 'Comandos disponibles:\n- cliente <codigo>: Buscar cliente por código\n- producto <codigo>: Buscar producto por código\n- buscar cliente <nombre>: Buscar clientes por nombre\n- buscar producto <nombre>: Buscar productos por nombre',
      data: null
    };
  }
}

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

module.exports = { ProcessQueryUseCase, ValidationError };
