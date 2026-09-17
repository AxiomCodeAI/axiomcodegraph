// The rest of the measured distribution, in one file so the counts are easy to
// read against schema §2.1's table:
//
//   parts in source | identities in the corpus
//   ----------------|-------------------------
//   1               | 686  (76.5%)   -> ../proj-partial-generated/
//   2               | 123            -> Two* below and ../csharp-only/partial/
//   3-8             | 65             -> Three*, Five*, Eight* below
//   10-30           | 20             -> Twelve* below
//   72, 88          | 2              -> parts72/, parts/
namespace Fixtures.Partial88;

public partial class TwoPartGroup { public int A; }
public partial class TwoPartGroup { public int B; }

public partial class ThreePartGroup { public int A; }
public partial class ThreePartGroup { public int B; }
public partial class ThreePartGroup { public int C; }

public partial class FivePartGroup { public int A; }
public partial class FivePartGroup { public int B; }
public partial class FivePartGroup { public int C; }
public partial class FivePartGroup { public int D; }
public partial class FivePartGroup { public int E; }

public partial class EightPartGroup { public int A; }
public partial class EightPartGroup { public int B; }
public partial class EightPartGroup { public int C; }
public partial class EightPartGroup { public int D; }
public partial class EightPartGroup { public int E; }
public partial class EightPartGroup { public int F; }
public partial class EightPartGroup { public int G; }
public partial class EightPartGroup { public int H; }

public partial class TwelvePartGroup { public int A01; }
public partial class TwelvePartGroup { public int A02; }
public partial class TwelvePartGroup { public int A03; }
public partial class TwelvePartGroup { public int A04; }
public partial class TwelvePartGroup { public int A05; }
public partial class TwelvePartGroup { public int A06; }
public partial class TwelvePartGroup { public int A07; }
public partial class TwelvePartGroup { public int A08; }
public partial class TwelvePartGroup { public int A09; }
public partial class TwelvePartGroup { public int A10; }
public partial class TwelvePartGroup { public int A11; }
public partial class TwelvePartGroup { public int A12; }

// A ONE-part partial in the same project as the 88-part one, so a query that
// groups correctly returns both 1 and 89 and a query that does not returns
// something uniform.
public partial class SinglePartGroup { public int Only; }
