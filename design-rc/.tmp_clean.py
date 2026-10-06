import io
p = 'js/features/analysis.js'
s = io.open(p, encoding='utf-8', newline='').read()

# 1) fix modal force units: tonnes*9.81*sa = kN -> x1000 for N
old = """          const ff = gamma * sa * mNode[i] * 9.81 * g; // t*9.81 = kN -> N
          if (Math.abs(ff) > 0) f.set(i, [ff * (comp === 0 ? 1 : 0), ff * (comp === 1 ? 1 : 0), ff * (comp === 2 ? 1 : 0), 0, 0, 0]);"""
assert s.count(old) == 1
new = """          const ff = gamma * sa * mNode[i] * 9810 * g; // t * 9.81 m/s2 = kN, x1000 = N
          if (Math.abs(ff) > 0) f.set(i, [comp === 0 ? ff : 0, comp === 1 ? ff : 0, comp === 2 ? ff : 0, 0, 0, 0]);"""
s = s.replace(old, new)

# 2) rewrite the reporting tail (drop the garbage lines)
start = s.index("      // story shears (base shear per direction)")
end = s.index("    return out;\n  }", start)
tail = """      // base shear per mode = total applied lateral force (signed sum),
      // CQC-combined + the missing-mass rigid term (kN)
      const vs = modalF.map((mf, k) => {
        // recompute the modal load sum directly: Sa*Gamma^2*g*mTot-normalized
        const m = used[k];
        return gammas[k] * asceSpectrum(m.T, { sds, sd1, tl }) * scale * gammas[k] * 9.81;
      });
      const vCQC = cqcCombine(vs, rhos);
      const vMiss = Math.max(0, 1 - Math.min(cumMass, 1)) * mTot * 9.81 * sa0;
      out.dirs[dir] = {
        frames: framesCQC,
        cumMass,
        baseShear: { cqc: vCQC, missing: vMiss, total: vCQC + vMiss },
      };
    }
"""
s = s[:start] + tail + s[end:]

# 3) drop the leftover solIdx-independent junk above (modalV loop)
old3 = """      // story shears (base shear per direction)
      let baseShear = 0;
      for (let k = 0; k < framesCQC.length; k++)
        if (mesh.frames[k].kind === 'column') baseShear = Math.max(baseShear, 0); // replaced below
      // report: total lateral force actually applied per mode (V = Sa*Gamma^2... ) use reactions? simpler: sum CQC of the applied modal base shears
      const modalV = used.map((m, k) => gammas[k] * asceSpectrum(m.T, { sds, sd1, tl }) * scale * (gammas[k] * 0 + Math.abs(gammas[k])) * 0);
      out.dirs[dir] = {"""
assert s.count(old3) == 1
s = s.replace(old3, "      out.dirs[dir] = {")

# also framesCQC references solIdx built before... verify the block still coherent: remove the stray comment line about modalF
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('cleaned')
