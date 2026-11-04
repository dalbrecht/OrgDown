# SPDX-License-Identifier: MIT
"""Run the OrgDown conformance vectors against orgdown.py.

Usage: python3 run_vectors.py [path-to-vectors-directory]
Exits 1 when any case fails.
"""

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import orgdown  # noqa: E402

DEFAULT_VECTORS = os.path.join(HERE, "..", "..", "conformance", "vectors")


def matches(expected, actual):
    """Field comparison: null in the expectation means absent or null."""
    if expected is None:
        return actual is None
    return expected == actual


def check_parse(case, response):
    expect = case["expect"]
    problems = []
    if "kinds" in expect and response["kinds"] != expect["kinds"]:
        problems.append("kinds: expected %r got %r" % (expect["kinds"], response["kinds"]))
    if "tasks" in expect:
        tasks = response["tasks"]
        if len(tasks) != len(expect["tasks"]):
            problems.append("task count: expected %d got %d" % (len(expect["tasks"]), len(tasks)))
        else:
            for position, (want, task) in enumerate(zip(expect["tasks"], tasks), 1):
                for name, value in want.items():
                    if not matches(value, task[name]):
                        problems.append("task %d %s: expected %r got %r" % (position, name, value, task[name]))
    return problems


def run_case(case, file_op):
    request = dict(case)
    request["op"] = case.get("op", file_op)
    request.pop("expect")
    response = orgdown.handle_request(request)
    op = request["op"]
    expected = case["expect"]
    if op == "parse":
        return check_parse(case, response)
    if op == "validate":
        key = lambda d: {"code": d["code"], "line": d["line"], "severity": d["severity"]}
        if not isinstance(response, list):
            return ["got %r" % (response,)]
        return check_value([key(d) for d in expected], [key(d) for d in response])
    if op == "fromCore":
        response = {"text": response["text"], "warnings": response["warnings"]}
    return check_value(expected, response)


def check_value(expected, actual):
    return [] if expected == actual else ["expected %r\n      got      %r" % (expected, actual)]


def main(argv):
    directory = argv[1] if len(argv) > 1 else DEFAULT_VECTORS
    passed = failed = 0
    for name in sorted(os.listdir(directory)):
        if not name.endswith(".json"):
            continue
        with open(os.path.join(directory, name), encoding="utf-8") as handle:
            data = json.load(handle)
        for case in data["cases"]:
            try:
                problems = run_case(case, data.get("op"))
            except Exception as error:  # a crash is a failure, never a pass
                problems = ["exception %s: %s" % (type(error).__name__, error)]
            if problems:
                failed += 1
                print("FAIL %s/%s" % (data["module"], case["id"]))
                for problem in problems:
                    print("    " + problem)
            else:
                passed += 1
                print("PASS %s/%s" % (data["module"], case["id"]))
    print("\n%d passed, %d failed, %d total" % (passed, failed, passed + failed))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
