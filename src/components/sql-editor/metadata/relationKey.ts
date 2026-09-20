/**
 * Re-export of the shared relation-key derivation.
 *
 * The derivation moved to `src/lib/relationMetadata/identity.ts`. It must have
 * exactly one implementation: the metadata cache is keyed by the folded identity,
 * so two derivations would split one physical relation into two entries.
 */

export {
  buildEditorRelationKey,
  hasNamespace,
  qualifiedNameText,
  relationBaseName,
  relationIdentityKey,
} from '../../../lib/relationMetadata/identity';
