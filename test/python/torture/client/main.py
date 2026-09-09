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
import f14_class_objects as f14
import f15_attribute_chains as f15
import f16_element_types as f16
import f18_lambda_dispatch as f18
import f19_reexports as f19
import f20_builtin_flow as f20
import f21_module_alias as f21
import f22_typeref_fk as f22
import f23_typevar_bound as f23
import f24_star_all as f24
import f25_var_params as f25
import f26_local_annotation as f26
import f27_with_target as f27
import f28_await as f28
import f29_subscript as f29
import f30_builtin_elements as f30
import f31_named_blind_spots as f31
import f32_iteration_protocol as f32
import f33_type_stubs as f33
import f34_reexport_union as f34
import f35_generic_union as f35
import f36_property_result as f36
import f37_classmethod_pairing as f37
import f38_nested_class_scope as f38
import f39_lib_boundary_identity as f39
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
    print(f14.via_binding(), f14.via_or(None), f14.via_ternary(True), f14.via_ternary(False))
    print(f14.via_type_annotation(f14.Para))
    r = f14.Registry()
    print(r.build_get("h"), r.build_get("zz"), r.build_subscript("p"))
    mid = f15.Middle(); hold = f15.Holder(mid)
    print(hold.via_self_two_hops(), hold.via_self_construction())
    print(f15.via_parameter(hold), f15.via_parameter_one_hop(mid), f15.via_local(hold))
    eng = f16.Engine([f16.Hook()])
    print(eng.via_self(0), f16.via_parameter(eng, 0), f16.via_parameter_from_param_field(eng, 0))
    print(f16.via_comprehension(eng), f16.via_local(eng, 0))
    print(f16.via_library_container_return())
    r = f18.Renderer()
    print(r.dispatch_computed("a", 1), r.dispatch_computed("b", 2), r.dispatch_pinned(3))
    print(f18.via_other_receiver(4))
    print(f19.via_package_attribute(), f19.via_reexported_function(), f19.via_submodule_alias())
    h = f20.Holder()
    print(f20.chained_str("_a-b_"), f20.split_then_index("a,b"), f20.local_keeps_type(" c "))
    print(f20.non_self_attribute(h), f20.non_self_attribute_container(h), f20.UsesSelf().via_self())
    print(f21.construct_through_alias(), f21.call_function_through_alias())
    print(f22.label_via_dotted(f22.impl.Node()), f22.build_via_dotted())
    print(f23.via_opaque_value(), f23.via_concrete_argument(), f23.constrained(1))
    print(f24.via_star_export(), f24.absent_from_all(), f24.absent_by_underscore())
    print(f25.Holder(a='x').lookup('a'), f25.collect(1, 2, 1), f25.annotated_kwargs(a='y'), f25.annotated_varargs(1, 2, 1))
    print(f26.from_builtin_annotation(), f26.from_class_annotation(), f26.from_dotted_annotation())
    print(f27.via_declared_enter(), f27.via_self_enter())
    print(f28.drive())
    print(f29.drive())
    print(f30.drive())
    print(f31.drive())
    print(f32.drive())
    print(f33.drive())
    print(f34.drive())
    print(f35.drive())
    print(f36.drive())
    print(f37.drive())
    print(f38.drive())
    print(f39.drive())


if __name__ == "__main__":
    main()
