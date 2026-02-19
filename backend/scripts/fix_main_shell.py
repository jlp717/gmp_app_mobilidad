"""Fix ternary operators by line number — most reliable approach"""

fp = r'c:\Users\Javier\Desktop\Repositorios\gmp_app_mobilidad\lib\features\dashboard\presentation\pages\main_shell.dart'

with open(fp, 'r', encoding='utf-8') as f:
    lines = f.readlines()

print(f"Total lines: {len(lines)}")

# Show the problematic lines first
for i in [459, 460, 461, 462, 463, 464, 465, 466, 467, 468, 469, 470]:
    print(f"  Line {i+1}: {repr(lines[i].rstrip())}")

# Line 463 (0-indexed 462): should have "? Colors.orange.withOpacity(0.15)" before the ":"
# Currently it says: "                                   : AppTheme.neonBlue.withOpacity(0.15),"
# It should be two lines:
#   "                                       ? Colors.orange.withOpacity(0.15) \n"
#   "                                       : AppTheme.neonBlue.withOpacity(0.15),\n"

# Line 469 (0-indexed 468): similar issue for border
# Currently: "                                     : AppTheme.neonBlue.withOpacity(0.5),"
# Should be two lines with the orange line first

# Determine line ending
eol = '\r\n' if lines[0].endswith('\r\n') else '\n'

fixes_applied = 0

# Fix line 463 (0-indexed 462)
if ': AppTheme.neonBlue.withOpacity(0.15),' in lines[462]:
    indent = '                                       '
    lines[462] = indent + '? Colors.orange.withOpacity(0.15) ' + eol
    lines.insert(463, indent + ': AppTheme.neonBlue.withOpacity(0.15),' + eol)
    fixes_applied += 1
    print("Fix A applied at line 463")
else:
    print(f"Fix A: Line 463 content doesn't match: {repr(lines[462].rstrip())}")

# After inserting a line, the second fix is now at line 470 (0-indexed 469)
target_line = 469 if fixes_applied > 0 else 468
if ': AppTheme.neonBlue.withOpacity(0.5),' in lines[target_line]:
    indent = '                                         '
    lines[target_line] = indent + '? Colors.orange.withOpacity(0.5) ' + eol
    lines.insert(target_line + 1, indent + ': AppTheme.neonBlue.withOpacity(0.5),' + eol)
    fixes_applied += 1
    print(f"Fix B applied at line {target_line + 1}")
else:
    print(f"Fix B: Line {target_line+1} content doesn't match: {repr(lines[target_line].rstrip())}")

with open(fp, 'w', encoding='utf-8') as f:
    f.writelines(lines)

print(f"Fixes applied: {fixes_applied}")
print("Done!")
