import { clientBundle } from '../../client/tsdown.client.ts'
import { typertPlugin } from '../../typert/generator/lib/types/tsdown-plugin.js'

export default clientBundle('@deepseek-ai/dsh-experimental-sai', ['lib/types/index.js'], {
  hostPhase: true,
  // The Remote contract (`./remote`, `./typert`) is generated from this package's Host face.
  lib: { plugins: [typertPlugin({ mode: 'package', faces: ['host'] })] },
})
