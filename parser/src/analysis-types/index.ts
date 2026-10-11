// Java analysis types
export { TypeRegistry } from '@/analysis-types/java/TypeRegistry';
export { TypeParameter } from '@/analysis-types/java/TypeParameter';
export { TypeReference } from '@/analysis-types/java/TypeReference';
export { EnumConstant } from '@/analysis-types/java/EnumConstant';
export { FieldRegistry } from '@/analysis-types/java/FieldRegistry';
export { ExpressionReference } from '@/analysis-types/java/ExpressionReference';
export { LocalVariableRegistry } from '@/analysis-types/java/LocalVariableRegistry';

// Properties analysis types
export { PropertyKey } from '@/analysis-types/properties/PropertyKey';
export { PropertyValueSegment } from '@/analysis-types/properties/PropertyValueSegment';

// XML analysis types
export { XmlElement } from '@/analysis-types/xml/XmlElement';
export { XmlAttribute } from '@/analysis-types/xml/XmlAttribute';
export { XmlValueReference } from '@/analysis-types/xml/XmlValueReference';

// YAML analysis types
export { YamlProperty } from '@/analysis-types/yaml/YamlProperty';
export { YamlValueSegment } from '@/analysis-types/yaml/YamlValueSegment';

// HTML analysis types (the web front end)
export {
  HtmlAttribute, HtmlClassReference, HtmlDocument, HtmlElement, HtmlHandlerCall, HtmlParseGap, HtmlReference, HtmlScript,
  HtmlTemplateExpression,
} from '@/analysis-types/html';

// CSS analysis types (the web front end)
export {
  CssComment, CssDeclaration, CssParseGap, CssRule, CssSelector, CssSelectorPart, CssStylesheet, CssValueReference,
} from '@/analysis-types/css';
