using System;
using System.Collections.Generic;

namespace App
{
    public class Bus
    {
        private readonly List<Action<string>> listeners = new List<Action<string>>();

        public void On(Action<string> listener)
        {
            listeners.Add(listener);
        }

        public void Emit(string x)
        {
            foreach (var listener in listeners)
            {
                listener(x);
            }
        }
    }
}
