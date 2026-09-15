package probe;

import static probe.Outer.Builder.create;
import static probe.Outer.Inner;
import static probe.Outer.Mode.FAST;

/**
 * Every call here reaches a nested type through a path that only works when the type's
 * qualifiedName carries its outer: a static import of a method, a constant or the nested type
 * itself; a dotted chain two levels deep; a type annotation between the segments; the outer as an
 * expression qualifier; and an implementor calling an override whose parameter is an inherited
 * member type.
 */
public class Use {

    /** import static probe.Outer.Builder.create: Outer's Builder, not Other's. */
    Outer viaStaticImportedMethod() {
        return create().build();
    }

    /** import static probe.Outer.Mode.FAST: a constant of a nested enum. */
    String viaStaticImportedConstant() {
        return FAST.label();
    }

    /** import static probe.Outer.Inner: a static nested type is a static member too. */
    String viaStaticImportedType() {
        return new Inner().tag();
    }

    /** A dotted chain two levels deep, written out. */
    String viaDottedChain() {
        Outer.Inner.Deep d = new Outer.Inner.Deep();
        return d.deep();
    }

    /** A TYPE_USE annotation between the segments: the declared type is still Outer.Inner. */
    String viaAnnotatedQualifiedType() {
        Outer.@Nullable Inner ann = new Outer.Inner();
        return ann.tag();
    }

    /** The outer as an expression qualifier of a static call on the nested type. */
    String viaOuterQualifier() {
        return Outer.Inner.build().tag();
    }

    /** Other's Builder by its own chain, beside Outer's. */
    Other viaOtherBuilder() {
        return Other.Builder.create().build();
    }

    /**
     * Sub.use(Kind) stays a dispatch target although its parameter names an inherited member type:
     * with the argument typed as Base.Kind, an override whose parameter did not resolve would be
     * evicted by the one that did.
     */
    void viaInheritedMemberType(Base b) {
        b.use(Base.Kind.A);
    }

    public static void main(String[] args) {
        Use u = new Use();
        u.viaStaticImportedMethod();
        u.viaStaticImportedConstant();
        u.viaStaticImportedType();
        u.viaDottedChain();
        u.viaAnnotatedQualifiedType();
        u.viaOuterQualifier();
        u.viaOtherBuilder();
        u.viaInheritedMemberType(new Sub());
    }
}
