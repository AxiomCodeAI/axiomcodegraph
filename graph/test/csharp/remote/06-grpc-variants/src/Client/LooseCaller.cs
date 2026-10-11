using Grpc.Net.Client;

namespace Elsewhere
{
    // control: no namespace or using says which Registry this is, so both stay candidates
    public class LooseCaller
    {
        public void Run(Registry.RegistryClient client) => client.Lookup(new Request());
    }

    // the qualifier names the namespace: Gadgets.Rpc's Registry only
    public class QualifiedCaller
    {
        public void Run(Gadgets.Rpc.Registry.RegistryClient client) => client.Lookup(new Request());
    }
}
