/*
 * Copyright (c) 2019-present, the fixture authors.
 * All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * @flow
 */
// fixture: flow/detection-miss/after-long-licence.js
// nature: runtime-bearing — it has statements; what the parser DOES with them is the next line
// expected provenance: FLOW_REJECTED — and the detector MISSES IT — the pragma sits past the 2,048-byte window, so the parser emits it as PROJECT
//
// MEASURED: `hasFlowPragma` is `/@flow\b/.test(sourceText.slice(0, 2048))`.
// The pragma above sits past that bound, so the detector returns false and this
// file is emitted as ordinary JavaScript. Under schema 2.6 that makes it a
// DETECTION MISS, and `declaredTypeSource = SYNTACTIC_FLOW` on the parameter
// below is the named residual that is supposed to say so.
//
// This is not a contrived length. A widely-copied house style puts the pragma at
// the END of a copyright block, and an Apache-2.0 header with a contributor
// notice reaches this size in real repositories. The bound's stated purpose is
// to stop the word matching "in any prose comment" -- but a licence is prose,
// and it is exactly what sits above a pragma.
//
// The fix is not simply a bigger number: any bound can be exceeded. Bounding to
// the leading COMMENT RUN rather than to a byte count is the shape that cannot
// be outgrown, and it is js-impl's call.

export function flowAfterLongLicenceMarker(x: number): string {
  return String(x);
}
