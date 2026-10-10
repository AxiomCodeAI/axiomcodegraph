using System.Threading.Tasks;

namespace App
{
    public static class Route
    {
        public static string Handle(dynamic handler, object req)
        {
            return handler(req).Render();
        }

        public static string HandleLocal(dynamic handler, object req)
        {
            var resp = handler(req);
            string text = resp.Render();
            resp.Close();
            return text;
        }

        public static string HandleOptional(dynamic handler, object req)
        {
            return handler(req)?.Render();
        }

        public static string HandleBuilder(dynamic handler, object req)
        {
            return handler(req).Step().Done().Render();
        }

        public static async Task<string> HandleAsync(dynamic handler, object req)
        {
            var resp = await handler(req);
            return resp.Render();
        }

        public static void HandleMany(dynamic handler, object req)
        {
            foreach (var r in handler(req))
            {
                r.Render();
            }
        }
    }
}
