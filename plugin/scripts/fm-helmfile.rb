# firstmate: list the releases of a helmfile.yaml that can be rendered locally with `helm template`.
#   ruby fm-helmfile.rb <helmfile.yaml>
# Output, tab-separated: RELEASE <name> <namespace> <chart dir> <values file>...
#                    or: SKIP <reason>
# Only local charts (paths starting with . or /) and plain values files are rendered; go-templated
# helmfiles, remote charts and inline values maps are reported as SKIP.
require "yaml"

path = ARGV.fetch(0)
text = File.read(path, encoding: "UTF-8")
if text.include?("{{")
  puts "SKIP\t#{File.basename(path)} uses go templates; render it in CI with helmfile"
  exit 0
end

docs = YAML.load_stream(text).compact
releases = docs.flat_map { |d| d.is_a?(Hash) ? Array(d["releases"]) : [] }
puts "SKIP\tno releases found" if releases.empty?

releases.each do |r|
  name = r["name"].to_s
  chart = r["chart"].to_s
  unless chart.start_with?(".", "/")
    puts "SKIP\t#{name}: chart '#{chart}' is not a local path"
    next
  end
  values = Array(r["values"]).select { |v| v.is_a?(String) }
  inline = Array(r["values"]).size - values.size
  puts "SKIP\t#{name}: #{inline} inline values block(s) not included" if inline.positive?
  ns = r["namespace"].to_s
  puts ["RELEASE", name, ns.empty? ? "-" : ns, chart, *values].join("\t")
end
