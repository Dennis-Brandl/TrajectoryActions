import StyleDictionary from 'style-dictionary'

const isPrimitive = (token) => token.filePath.replace(/\\/g, '/').includes('/primitives/')

// Light: primitives + light semantic + brand (theme-invariant). Emitted to :root.
const sdLight = new StyleDictionary({
  source: [
    'tokens/primitives/**/*.json',
    'tokens/semantic/light/**/*.json',
    'tokens/semantic/brand.json',
  ],
  platforms: {
    css: {
      transformGroup: 'css',
      buildPath: 'dist/',
      files: [
        {
          destination: 'tokens.light.css',
          format: 'css/variables',
          options: { selector: ':root' },
        },
      ],
    },
  },
})

// Dark: primitives loaded only so references resolve; filtered out of output so
// .dark only carries the override values that differ from light.
const sdDark = new StyleDictionary({
  source: ['tokens/primitives/**/*.json', 'tokens/semantic/dark/**/*.json'],
  platforms: {
    css: {
      transformGroup: 'css',
      buildPath: 'dist/',
      files: [
        {
          destination: 'tokens.dark.css',
          format: 'css/variables',
          options: { selector: '.dark' },
          filter: (token) => !isPrimitive(token),
        },
      ],
    },
  },
})

await sdLight.cleanAllPlatforms()
await sdDark.cleanAllPlatforms()
await sdLight.buildAllPlatforms()
await sdDark.buildAllPlatforms()
