def plan_route(stops):
    return sorted(stops)


def estimate_distance(stops):
    return len(plan_route(stops))
