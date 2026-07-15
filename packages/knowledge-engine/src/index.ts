export {
  createKnowledgeStore,
  KnowledgeStoreError,
  type AddChunkInput,
  type AddEmbeddingInput,
  type AuthorityLevel,
  type DataClassification,
  type KnowledgeChunk,
  type KnowledgeEmbedding,
  type KnowledgeSource,
  type KnowledgeSourceStatus,
  type KnowledgeStore,
  type KnowledgeVersion,
  type PublishVersionInput,
  type RegisterSourceInput,
} from "./store.js";

export {
  createKnowledgeRetrievalPort,
  KnowledgeRetrievalError,
  type KnowledgePolicy,
  type KnowledgeQuery,
  type KnowledgeRetrievalPort,
  type KnowledgeRetrievalResult,
  type RetrievedChunk,
} from "./retrieval.js";
