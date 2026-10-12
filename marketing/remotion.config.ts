import { Config } from '@remotion/cli/config';
import { enableTailwind } from '@remotion/tailwind-v4';

Config.setEntryPoint('src/index.ts');
Config.overrideWebpackConfig(enableTailwind);
Config.setVideoImageFormat('jpeg');
Config.setJpegQuality(95);
