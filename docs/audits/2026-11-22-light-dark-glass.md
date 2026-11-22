# Light and Dark glass defaults

Light and Dark glass use 40% fill opacity and a 5 px backdrop blur in both material renderers. The fallback continues to inherit the shared surface and disables refraction. Clear retains 0% fill and 2 px blur. Prominent retains its accent tint, 50% fill and 3 px blur. Preset parity is covered by the material tuning test. The change adjusts two surface parameters and introduces no new layers or recalculation paths. No device-level blur benchmark was run.
