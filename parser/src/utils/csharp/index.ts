export {
  CSHARP_RESERVED_KEYWORDS,
  isVerbatimIdentifier,
  normalizeCSharpIdentifier,
} from '@/utils/csharp/csharp-identifier-utils';
export {
  CSHARP_PREDEFINED_TYPE_ALIASES,
  baseTypeName,
  clrGenericName,
  hasNullableAnnotation,
  isPredefinedType,
  isPredefinedValueType,
  predefinedTypeAlias,
  qualifierOf,
  simpleNameOf,
  typeArgumentArity,
} from '@/utils/csharp/csharp-type-utils';
