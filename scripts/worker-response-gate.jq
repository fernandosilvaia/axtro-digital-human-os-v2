def required_zero_counter($name):
  has($name)
  and (.[$name] | type == "number" and . == 0);

(.ok == true)
and required_zero_counter("failed")
and required_zero_counter("deadLettered")
and required_zero_counter("deadLetterBacklog")
and required_zero_counter("unknown")
and required_zero_counter("cleanupPending")
and (
  (has("operatorRequired") and required_zero_counter("operatorRequired"))
  or ((has("operatorRequired") | not) and (.catalogVerified == true))
)
