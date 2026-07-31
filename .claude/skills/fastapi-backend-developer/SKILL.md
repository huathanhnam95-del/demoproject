---
name: fastapi-backend-developer
description: Specialized in designing and implementing high-performance FastAPI backends with Pydantic v2, async/await patterns, and robust dependency injection.
---

# FastAPI Backend Developer Skill

Expert guidance for building modern, scalable backends using FastAPI and Pydantic.

## Use this skill when

- Designing API endpoints and request/response schemas.
- Implementing asynchronous business logic.
- Setting up dependency injection for services (DB, AI models).
- Configuring middleware (CORS, Auth, Logging).
- Writing integration tests with `TestClient` or `httpx`.
- Optimizing Pydantic model performance.

## Core Patterns

### Endpoint Definition

```python
from fastapi import APIRouter, Depends, HTTPException
from app.schemas.my_schema import MyRequest, MyResponse

router = APIRouter()

@router.post("/process", response_model=MyResponse)
async def process_data(
    request: MyRequest,
    service: MyService = Depends(get_my_service)
):
    try:
        return await service.execute(request)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
```

### Pydantic v2 Best Practices

- Use `Annotated` for dependency injection and field metadata.
- Prefer `BaseModel` with `model_config = {"extra": "forbid"}` for strict APIs.
- Use `Field(default_factory=...)` for mutable types.

### Async Safety

- Always use `await` for I/O bound operations.
- Avoid blocking the event loop with heavy CPU tasks (offload to `run_in_executor` if needed).

## Checklist

- [ ] Schema validation matches production expectations.
- [ ] Dependency injection is used for testability.
- [ ] Error handling returns structured JSON.
- [ ] Documentation (OpenAPI) is clear and typed.
