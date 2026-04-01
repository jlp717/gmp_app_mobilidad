/**
 * Base Use Case - Application Layer Pattern
 * All use cases implement the execute method
 */
class UseCase {
  async execute(params) {
    throw new Error('Method not implemented: execute');
  }
}

module.exports = { UseCase };
