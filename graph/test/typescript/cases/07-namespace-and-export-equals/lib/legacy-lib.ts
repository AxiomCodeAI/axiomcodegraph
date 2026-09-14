declare namespace vendor {
  function pack(): string;
  namespace inner {
    function deepPack(): string;
    class Node {
      visit(): string;
    }
  }
}
export = vendor;
