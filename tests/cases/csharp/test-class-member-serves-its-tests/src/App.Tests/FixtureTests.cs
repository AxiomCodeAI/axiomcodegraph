using System;
using App;
using Xunit;

namespace App.Tests;

public class ConnectionFixture : IDisposable
{
    public ConnectionFixture() { Calc.Open(1); }
    public void Dispose() { }
}

public class OrphanFixture
{
    public OrphanFixture() { Calc.Orphan(1); }
}

public class StoreTests : IClassFixture<ConnectionFixture>
{
    public StoreTests(ConnectionFixture fx) { }

    [Fact]
    public void Count() => Assert.True(true);
}

public class PlainTests
{
    [Fact]
    public void Nothing() => Assert.True(true);
}

public class DatabaseFixture
{
    public DatabaseFixture() { Calc.Shared(1); }
}

[CollectionDefinition("db")]
public class DatabaseCollection : ICollectionFixture<DatabaseFixture> { }

[Collection("db")]
public class QueryTests
{
    [Fact]
    public void Query() => Assert.True(true);
}

public class CleanupTests : IDisposable
{
    public void Dispose() { Calc.Close(1); }

    [Fact]
    public void First() => Assert.True(true);

    [Fact]
    public void Second() => Assert.True(true);
}
