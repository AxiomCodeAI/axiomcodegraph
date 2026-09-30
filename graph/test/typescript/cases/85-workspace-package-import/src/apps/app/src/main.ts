import { f, Bus, K } from '@x/lib';
import { g } from '@x/lib/sub';
import { isOn } from '@x/lib/feature/flags';
import { tool } from 'tools';
import { deep } from 'tools/deep';
// Control: a third-party package no workspace declares stays a library import.
import { z } from 'zod';

import { local } from './local';

export class S {
  constructor(private bus: Bus) {}

  run(): void {
    f();
    g();
    this.bus.publish(K);
    if (isOn('x')) {
      tool();
    }
    deep();
    local();
    z.string();
  }
}
