# stage-rows.sh: copy one IR CSV into a Soufflé fact file, dropping torn rows. Sourced by run-souffle.sh.
#
#   stage_rows FILE    print FILE's rows without its header, keeping only the rows whose tab-separated
#                      field count equals the header's; report how many were dropped on stderr.
#
# The filter is line based: a row is one newline-terminated line, a field count is the number of tabs
# plus one (an empty line has none), and a last line without a newline is printed with one. Those are
# exactly awk -F'\t' semantics, which is what this step used to run.
#
# PERL FIRST, AWK AS THE FALLBACK. The two print byte-identical output, but BSD awk (macOS) spends most
# of a build's staging time splitting fields it never reads: 13.6 CPU-s on a 352 MB expressions file,
# against 0.65 s for perl, which only counts tabs. perl ships with macOS, every mainstream Linux
# distribution and Git for Windows' bash (the shell this runs under on win32); a minimal image without
# it (Alpine, distroless) gets the same rows from awk, just slower. graph/test/tools/stage-rows-test.sh
# holds both to the same bytes on the edge cases (trailing tabs, empty lines, CRLF, no final newline).
#
# AXIOM_STAGE_WITH=awk forces the fallback (the test uses it; so can anyone bisecting a staging change).

if [ "${AXIOM_STAGE_WITH:-}" != awk ] && command -v perl >/dev/null 2>&1 && perl -e 1 >/dev/null 2>&1; then
  STAGE_ROWS_TOOL=perl
else
  STAGE_ROWS_TOOL=awk
fi

stage_rows(){
  if [ "$STAGE_ROWS_TOOL" = perl ]; then
    # Bytes in, bytes out (no PerlIO layers, whatever PERL_UNICODE says), and $/ pinned to "\n".
    perl -e '
      my $f = $ARGV[0];
      open(my $h, "<:raw", $f) or die "cannot read $f: $!\n";
      binmode STDOUT, ":raw";
      local $/ = "\n";
      my $hdr = <$h>;
      exit 0 unless defined $hdr;
      my $hl = length($hdr) - (substr($hdr, -1) eq "\n" ? 1 : 0);
      my $n = $hl ? ($hdr =~ tr/\t//) + 1 : 0;
      my $bad = 0;
      while (my $l = <$h>) {
        my $nl = substr($l, -1) eq "\n";
        my $nf = (length($l) - ($nl ? 1 : 0)) ? ($l =~ tr/\t//) + 1 : 0;
        if ($nf == $n) { print($nl ? $l : "$l\n") } else { $bad++ }
      }
      close($h);
      close(STDOUT) or die "cannot write the staged rows of $f: $!\n";
      printf STDERR "  ! dropped %d malformed row(s) from %s\n", $bad, $f if $bad > 0;
    ' "$1"
  else
    awk -F'\t' 'NR==1{n=NF; next} NF==n{print; next} {bad++} END{if(bad>0) printf "  ! dropped %d malformed row(s) from %s\n", bad, FILENAME > "/dev/stderr"}' "$1"
  fi
}
