using System;
using Invoice.Api.Services;
using Xunit;

namespace Invoice.Api.Tests;

public class GoalCalculationServiceTests
{
    [Fact]
    public void CalculateNetSpent_ShouldAddDebitsAndCredits()
    {
        var debits = 19341.18m;
        var credits = -89.20m;
        var net = GoalCalculationService.CalculateNetSpent(debits, credits);
        Assert.Equal(19251.98m, net);
    }

    [Fact]
    public void CalculateAvailable_WhenWithinGoal_ShouldReturnPositiveDifference()
    {
        var goal = 25000.00m;
        var netSpent = 19251.98m;
        var available = GoalCalculationService.CalculateAvailable(goal, netSpent);
        Assert.Equal(5748.02m, available);
    }

    [Fact]
    public void CalculateAvailable_WhenOverGoal_ShouldReturnZero()
    {
        var goal = 1000m;
        var netSpent = 1200m;
        var available = GoalCalculationService.CalculateAvailable(goal, netSpent);
        Assert.Equal(0m, available);
    }

    [Theory]
    [InlineData(25000, 19251.98, 77.0)]
    [InlineData(1000, 720, 72.0)]
    [InlineData(1000, 1000, 100.0)]
    [InlineData(1000, 1500, 150.0)]
    [InlineData(0, 500, 0.0)]
    public void CalculatePercentage_ShouldReturnExpectedRoundedValue(decimal goal, decimal netSpent, decimal expected)
    {
        var percentage = GoalCalculationService.CalculatePercentage(goal, netSpent);
        Assert.Equal(expected, percentage);
    }

    [Theory]
    [InlineData(0, 0, "no_goal")]
    [InlineData(1000, 72.0, "normal")]
    [InlineData(1000, 79.9, "normal")]
    [InlineData(1000, 80.0, "warning")]
    [InlineData(1000, 99.9, "warning")]
    [InlineData(1000, 100.0, "danger")]
    [InlineData(1000, 150.0, "danger")]
    public void DetermineStatus_ShouldReturnCorrectThreshold(decimal goal, decimal percentage, string expectedStatus)
    {
        var status = GoalCalculationService.DetermineStatus(goal, percentage);
        Assert.Equal(expectedStatus, status);
    }

    [Fact]
    public void CalculateProjection_ForCurrentMonth_ShouldCalculateBasedOnDays()
    {
        // On day 15 of a 30-day month (April 2026), spending R$ 1000 -> projection should be R$ 2000
        var currentDate = new DateTime(2026, 4, 15);
        var netSpent = 1000m;
        var projection = GoalCalculationService.CalculateProjection(netSpent, 2026, 4, currentDate);
        Assert.Equal(2000m, projection);
    }

    [Fact]
    public void CalculateProjection_ForPastMonth_ShouldReturnActualNetSpent()
    {
        var currentDate = new DateTime(2026, 9, 18);
        var netSpent = 15440.95m;
        var projection = GoalCalculationService.CalculateProjection(netSpent, 2026, 5, currentDate);
        Assert.Equal(15440.95m, projection);
    }

    [Fact]
    public void CalculateProjection_ForFutureMonth_ShouldReturnZero()
    {
        var currentDate = new DateTime(2026, 9, 18);
        var netSpent = 0m;
        var projection = GoalCalculationService.CalculateProjection(netSpent, 2026, 12, currentDate);
        Assert.Equal(0m, projection);
    }
}
