"""Exercises every case so tier-4 observes it. A case not called here is reported
UNCOVERED rather than silently counted as a miss."""
import f01_inheritance as f1
import f02_callables as f2
import f03_generics as f3
import f04_descriptors as f4
import f05_decorators as f5
import f06_flow as f6
import f07_imports as f7
import f08_dynamic as f8
import f09_adversarial as f9
import f10_forward_refs as f10
from pkgmod import user as pkguser
import f11_multiwrite as f11
import f12_value_flow as f12
import f13_declared_dispatch as f13
from tlib import Square
from tlib.shapes import Base, Mid


def main() -> None:
    print(f1.lib_deep_chain(), f1.lib_template_method(), f1.lib_diamond())
    print(f1.client_chain(), f1.virtual_over_constructed())
    print(f2.bare_name_callable(), f2.constructed_directly(), f2.closure_target())
    print(f2.module_level_fn(), f2.registry_dispatch(), f2.attribute_callables())
    print(f3.bound_generic(), f3.bound_generic_other(), f3.chained_generic())
    print(f3.unbound_generic())
    print(f3.class_named_like_a_typevar())
    print(f4.lib_classmethod_on_class(), f4.lib_property_read())
    print(f4.lib_staticmethod(), f4.client_descriptors())
    print(f5.call_lib_decorated(), f5.call_client_decorated(), f5.decorator_factory_applied())
    print(f6.takes_annotated(Square()), f6.takes_unannotated(Square()))
    print(f6.uses_return(), f6.passes_through(), f6.list_of_instances(), f6.augmented_flow())
    print(f7.via_package_attribute(), f7.via_module_alias(), f7.via_from_reexport())
    print(f7.via_from_declaring_module(), f7.via_module_function())
    print(f8.dict_dispatch_static_key(), f8.dict_dispatch_computed_key("ci"))
    print(f8.getattr_call(Square()), f8.conditional_type(True))
    print(f9.shadowed_method_name(), f9.override_of_an_inherited_method())
    print(f9.inherited_through_a_silent_class(), f9.rebound_attribute())
    print(f9.shadowed_against_a_library_name())
    h = f10.Holder()
    print(f10.quoted_param(h), f10.single_quoted_param(h), f10.uses_quoted_return())
    print(f10.quoted_optional(h), f10.quoted_generic_element([h]))
    print(f10.quoted_lib_param(Base()), f10.type_checking_only_param(Mid()))
    print(f10.Boxed(h).read())
    print(pkguser.run_generator([1, 2]), pkguser.run_generator_in_for([3, 4]))
    print(pkguser.run_plain([5]))
    print(f11.two_writes(True), f11.two_writes(False))
    print(f11.ternary(True), f11.ternary(False), f11.boolean_or(None))
    print(f11.boolean_or(f11.Fancy()), f11.ternary_over_lib(True), f11.ternary_over_lib(False))
    print(f11.HoldsTernary(True).run(), f11.HoldsTernary(False).run())
    print(f11.HoldsOr().run(), f11.HoldsOr(f11.Fancy()).run())
    print(f12.UsesFactory().run(), f12.method_alias_on_class())
    print(f12.method_alias_on_instance(), f12.getattr_literal())
    print(f12.getattr_with_default(object()), f12.getattr_default_callable(object()))
    for ld in (f13.FileLoader(), f13.DictLoader()):
        print(f13.Engine(ld).run("t"), f13.via_parameter(ld, "t"), f13.via_parameter_inherited(ld))
    print(f13.StepA().run(), f13.StepB().run(), f13.exact_receiver_is_not_widened())


if __name__ == "__main__":
    main()
