/// **Core Memory Module - GMP App**
/// 
/// Sistema unificado de memoria con:
/// - AgentDB: Backend persistente unificado
/// - HNSW Vector Search: Búsqueda semántica aproximada
/// - ReasoningBank: Aprendizaje adaptativo
/// - UnifiedMemoryLayer: Capa de abstracción
/// - DataMigration: Migración desde sistemas legacy
/// 
/// @see {@link AgentDatabase}
/// @see {@link UnifiedMemoryLayer}
/// @see {@link ReasoningBank}
library memory;

export 'agent_database.dart';
export 'vector_store_hnsw.dart';
export 'reasoning_bank.dart';
export 'unified_memory_layer.dart';
export 'data_migration.dart';
