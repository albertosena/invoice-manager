namespace Invoice.Api.Services;

public static class GoalCalculationService
{
    public static decimal CalculateNetSpent(decimal debits, decimal credits)
    {
        return debits + credits;
    }

    public static decimal CalculateAvailable(decimal goalAmount, decimal netSpent)
    {
        return Math.Max(0m, goalAmount - netSpent);
    }

    public static decimal CalculatePercentage(decimal goalAmount, decimal netSpent)
    {
        if (goalAmount <= 0m) return 0m;
        var pct = (netSpent / goalAmount) * 100m;
        return Math.Round(pct, 1);
    }

    public static string DetermineStatus(decimal goalAmount, decimal percentage)
    {
        if (goalAmount <= 0m) return "no_goal";
        if (percentage < 80m) return "normal";
        if (percentage < 100m) return "warning";
        return "danger";
    }

    public static decimal CalculateProjection(decimal netSpent, int year, int month, DateTime currentDate)
    {
        var totalDays = DateTime.DaysInMonth(year, month);

        if (year < currentDate.Year || (year == currentDate.Year && month < currentDate.Month))
        {
            return netSpent;
        }

        if (year > currentDate.Year || (year == currentDate.Year && month > currentDate.Month))
        {
            return 0m;
        }

        var daysElapsed = Math.Min(currentDate.Day, totalDays);
        if (daysElapsed <= 0 || netSpent <= 0m)
        {
            return netSpent;
        }

        var dailyAverage = netSpent / (decimal)daysElapsed;
        return Math.Round(dailyAverage * (decimal)totalDays, 2);
    }
}
