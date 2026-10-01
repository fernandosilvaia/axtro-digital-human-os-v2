def nonnegative_integer:
  type == "number" and . >= 0 and floor == .;

def required_counter($name):
  has($name) and (.[$name] | nonnegative_integer);

def required_zero_counter($name):
  required_counter($name) and .[$name] == 0;

def required_age($name; $population):
  has($name) and (
    (.[$name] | nonnegative_integer)
    or (.[$name] == null and $population == 0)
  );

def required_counters($names):
  . as $payload | all($names[]; . as $name | $payload | required_counter($name));

def required_zero_counters($names):
  . as $payload | all($names[]; . as $name | $payload | required_zero_counter($name));

(type == "object")
and (.ok == true)
and required_counters(["leased", "failed", "deadLettered", "backlog", "deadLetterBacklog",
  "providerInFlight", "unknown", "cleanupPending"])
and required_zero_counters(["failed", "deadLettered", "deadLetterBacklog", "unknown", "cleanupPending"])
and (
  if $worker == "billing" then
    .catalogVerified == true
    and required_counter("delivered")
    and required_counter("held")
    and required_age("oldestAgeSeconds"; .backlog)
    and required_age("oldestHeldAgeSeconds"; .held)
    and required_age("oldestProviderPendingAgeSeconds"; .providerInFlight + .unknown + .cleanupPending)
    and ((has("operatorRequired") | not) or required_zero_counter("operatorRequired"))
  elif $worker == "reconciler" then
    required_counter("reconciled")
    and required_counter("processing")
    and required_zero_counter("operatorRequired")
    and required_age("oldestAgeSeconds"; .backlog + .processing + .deadLetterBacklog)
    and required_age("oldestUnknownAgeSeconds"; .unknown)
  else false end
)
